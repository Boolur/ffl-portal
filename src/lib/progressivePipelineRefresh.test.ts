import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProgressivePipelineRefresh } from './progressivePipelineRefresh';
import { appendPipelineRows, orderPipelineRows } from './processingPipelinePagination';

function deferred<T>() {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
type Row = { id: string; value?: string };
function setup() {
  const loadInitial = vi.fn(async (view: string) => ({ success: true as const, rows: [{ id: view }], total: 1, remainingIds: [] as string[] }));
  const loadMore = vi.fn(async (ids: string[]) => ({ success: true as const, rows: ids.map((id) => ({ id })) }));
  const callbacks = { onStart: vi.fn(), onPage: vi.fn(), onFailure: vi.fn(), onError: vi.fn(), onIdle: vi.fn() };
  const loader = createProgressivePipelineRefresh<string, Row>({ loadInitial, loadMore, ...callbacks });
  return { loader, loadInitial, loadMore, ...callbacks };
}
afterEach(() => vi.useRealTimers());

describe('progressive pipeline loading', () => {
  it('loads every remaining row in bounded batches while preserving result order', async () => {
    const s = setup();
    const ids = Array.from({ length: 251 }, (_, i) => `row-${i}`);
    s.loader.resume('pipeline', ids);
    await flush(); await flush();
    expect(s.loadMore.mock.calls.map(([batch]) => batch.length)).toEqual([100, 100, 51]);
    expect(s.onPage.mock.calls.flatMap(([page]) => page.rows.map((row: Row) => row.id))).toEqual(ids);
    expect(s.onPage.mock.calls.map(([page]) => page.remaining)).toEqual([151, 51, 0]);
    expect(s.onStart).not.toHaveBeenCalled();
    expect(s.loader.isBusy()).toBe(false);
  });

  it('prioritizes the latest search and discards any pending old-view chunk', async () => {
    const s = setup();
    const pending = deferred<{ success: true; rows: Row[] }>();
    s.loadMore.mockReturnValueOnce(pending.promise);
    s.loader.resume('old view', Array.from({ length: 201 }, (_, i) => String(i)));
    s.loader.request('borrower a');
    s.loader.request('borrower ab');
    pending.resolve({ success: true, rows: [{ id: 'stale' }] });
    await flush();
    expect(s.loadMore).toHaveBeenCalledTimes(1);
    expect(s.loadInitial).toHaveBeenCalledExactlyOnceWith('borrower ab');
    expect(s.onPage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rows: [{ id: 'borrower ab' }], append: false, remaining: 0 }));
  });

  it('reports inaccessible or deleted continuation rows so totals remain honest', async () => {
    const s = setup();
    s.loadMore.mockResolvedValueOnce({ success: true, rows: [{ id: 'still-visible' }] });
    s.loader.resume('pipeline', ['removed', 'still-visible']);
    await flush();
    expect(s.onPage).toHaveBeenCalledWith(expect.objectContaining({ removed: 1, remaining: 0 }));
  });

  it('retains the 20-second stop guard and does not append late responses', async () => {
    vi.useFakeTimers();
    const s = setup();
    const pending = deferred<{ success: true; rows: Row[] }>();
    s.loadMore.mockReturnValueOnce(pending.promise);
    s.loader.resume('pipeline', ['late']);
    await vi.advanceTimersByTimeAsync(20_000);
    s.loader.request('new search');
    pending.resolve({ success: true, rows: [{ id: 'late' }] });
    await flush();
    expect(s.onError).toHaveBeenCalledExactlyOnceWith(true);
    expect(s.onPage).not.toHaveBeenCalled();
    expect(s.loadInitial).not.toHaveBeenCalled();
    expect(s.onStart).not.toHaveBeenCalled();
  });

  it('stops remaining chunks on an authorization failure and permits a fresh search', async () => {
    const onFailure = vi.fn();
    const onPage = vi.fn();
    const loadMore = vi.fn(async () => ({ success: false as const, error: 'Not authorized.' }));
    const loadInitial = vi.fn(async () => ({ success: true as const, rows: [], total: 0, remainingIds: [] }));
    const loader = createProgressivePipelineRefresh<string, Row>({
      loadMore, loadInitial, onFailure, onPage, onStart: vi.fn(), onError: vi.fn(), onIdle: vi.fn(),
    });
    loader.resume('pipeline', Array.from({ length: 201 }, (_, i) => String(i)));
    await flush();
    expect(loadMore).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('Not authorized.');
    loader.request('new search');
    await flush();
    expect(loadInitial).toHaveBeenCalledOnce();
    expect(onPage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ rows: [], append: false, remaining: 0 }));
  });

  it('keeps global manifest ordering and never overwrites an edited visible row', () => {
    expect(orderPipelineRows(['c', 'b', 'a'], [{ id: 'a' }, { id: 'c' }])).toEqual([{ id: 'c' }, { id: 'a' }]);
    expect(appendPipelineRows([{ id: 'a', value: 'edited' }], [{ id: 'a', value: 'stale' }, { id: 'b' }, { id: 'b' }])).toEqual([{ id: 'a', value: 'edited' }, { id: 'b' }]);
  });

  it('discards a background response when editing starts, without requesting more chunks', async () => {
    const loadInitial = vi.fn(async () => ({ success: true as const, rows: [{ id: 'first' }], total: 2, remainingIds: ['next'] }));
    const loadMore = vi.fn(async () => ({ success: true as const, rows: [{ id: 'next' }] }));
    const onPage = vi.fn(() => false);
    const loader = createProgressivePipelineRefresh<string, Row>({ loadInitial, loadMore, onPage, onStart: vi.fn(), onFailure: vi.fn(), onError: vi.fn(), onIdle: vi.fn() });
    loader.request('pipeline');
    await flush();
    expect(onPage).toHaveBeenCalledOnce();
    expect(loadMore).not.toHaveBeenCalled();
    expect(loader.isBusy()).toBe(false);
  });

  it('resumes saved current-view progress after hiding instead of appending the old in-flight response', async () => {
    const s = setup();
    const pending = deferred<{ success: true; rows: Row[] }>();
    s.loadMore.mockReturnValueOnce(pending.promise);
    s.loader.resume('searched view', ['next']);
    s.loader.dispose();
    pending.resolve({ success: true, rows: [{ id: 'old response' }] });
    await flush();
    expect(s.onPage).not.toHaveBeenCalled();
    const resumed = setup();
    resumed.loader.resume('searched view', ['next']);
    await flush();
    expect(resumed.loadInitial).not.toHaveBeenCalled();
    expect(resumed.onPage).toHaveBeenCalledWith(expect.objectContaining({ view: 'searched view', rows: [{ id: 'next' }], remainingIds: [] }));
  });
});
