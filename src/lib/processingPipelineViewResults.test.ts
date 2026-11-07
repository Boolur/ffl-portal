import { describe, expect, it, vi } from 'vitest';
import { appendPipelineRows } from './processingPipelinePagination';
import { createProgressivePipelineRefresh } from './progressivePipelineRefresh';
import { selectProcessingPipelineViewResults, type ProcessingPipelineViewResults } from './processingPipelineViewResults';

type Row = { id: string; draft?: string };
type Page = { success: true; rows: Row[]; total: number; remainingIds: string[] };
type Failure = { success: false; error: string };
const query = (patch: Record<string, unknown> = {}) => JSON.stringify({
  sheet: 'PIPELINE', search: '', allSheets: false, viewScope: 'GLOBAL', filters: {}, ...patch,
});
const initial: ProcessingPipelineViewResults<Row> = {
  queryKey: query(), rows: [{ id: 'pipeline-loan', draft: 'unsaved note' }], total: 42, remainingCount: 41,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup() {
  let selected = initial.queryKey;
  let accepted = initial;
  const loadInitial = vi.fn<(view: string) => Promise<Page | Failure>>();
  const loadMore = vi.fn<(ids: string[], view: string) => Promise<{ success: true; rows: Row[] } | Failure>>();
  const onFailure = vi.fn();
  const loader = createProgressivePipelineRefresh<string, Row>({
    loadInitial, loadMore, onStart: vi.fn(), onFailure, onError: vi.fn(), onIdle: vi.fn(),
    onPage: ({ view, rows, append, total, remaining, removed }) => {
      accepted = {
        queryKey: view,
        rows: append ? appendPipelineRows(accepted.rows, rows) : rows,
        total: total ?? Math.max(0, accepted.total - removed),
        remainingCount: remaining,
      };
    },
  });
  return {
    loader, loadInitial, loadMore, onFailure,
    select(view: string) { selected = view; },
    visible: () => selectProcessingPipelineViewResults(selected, accepted),
  };
}

describe('Processing results belong to the selected view', () => {
  it.each([
    ['Restructures', { sheet: 'RESTRUCTURE' }],
    ['Fundings', { sheet: 'FUNDING' }],
    ['Rate Lock Requests', { sheet: undefined, rateLockRequestsOnly: true }],
    ['assigned layout scope', { viewScope: 'ASSIGNED' }],
    ['saved filters', { filters: { lenders: ['Example'] } }],
    ['search', { search: 'Mindy', allSheets: true }],
  ])('hides previous loans and counts immediately when selecting %s, before its request starts', (_name, patch) => {
    expect(selectProcessingPipelineViewResults(query(patch), initial)).toBeNull();
  });

  it('keeps the exact same-view rows and drafts available during a refresh', () => {
    expect(selectProcessingPipelineViewResults(query(), initial)).toBe(initial);
    expect(initial.rows[0].draft).toBe('unsaved note');
  });

  it('shows only the new sheet first page and appends only its remaining loans', async () => {
    const s = setup();
    const page = deferred<Page>();
    const continuation = deferred<{ success: true; rows: Row[] }>();
    s.loadInitial.mockReturnValueOnce(page.promise);
    s.loadMore.mockReturnValueOnce(continuation.promise);
    const restructures = query({ sheet: 'RESTRUCTURE' });
    s.select(restructures);
    expect(s.visible()).toBeNull();
    s.loader.request(restructures);
    expect(s.visible()).toBeNull();
    page.resolve({ success: true, rows: [{ id: 'restructure-1' }], total: 2, remainingIds: ['restructure-2'] });
    await flush();
    expect(s.visible()).toEqual({ queryKey: restructures, rows: [{ id: 'restructure-1' }], total: 2, remainingCount: 1 });
    continuation.resolve({ success: true, rows: [{ id: 'restructure-2' }] });
    await flush();
    expect(s.visible()?.rows.map(row => row.id)).toEqual(['restructure-1', 'restructure-2']);
    expect(s.visible()?.remainingCount).toBe(0);
  });

  it('allows a quick return to the same accepted view without showing a late other-sheet result', async () => {
    const s = setup();
    const old = deferred<Page>();
    const latest = deferred<Page>();
    s.loadInitial.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const restructures = query({ sheet: 'RESTRUCTURE' });
    s.select(restructures);
    s.loader.request(restructures);
    s.select(query());
    s.loader.request(query());
    expect(s.visible()).toBe(initial);
    old.resolve({ success: true, rows: [{ id: 'wrong-sheet' }], total: 1, remainingIds: [] });
    await flush();
    expect(s.visible()).toBe(initial);
    latest.resolve({ success: true, rows: [{ id: 'pipeline-current' }], total: 1, remainingIds: [] });
    await flush();
    expect(s.visible()?.rows).toEqual([{ id: 'pipeline-current' }]);
  });

  it('never restores the other sheet after a failed request and accepts a retry', async () => {
    const s = setup();
    const restructures = query({ sheet: 'RESTRUCTURE' });
    s.loadInitial.mockResolvedValueOnce({ success: false, error: 'Please retry.' });
    s.select(restructures);
    s.loader.request(restructures);
    await flush();
    expect(s.onFailure).toHaveBeenCalledWith('Please retry.');
    expect(s.visible()).toBeNull();
    s.loadInitial.mockResolvedValueOnce({ success: true, rows: [], total: 0, remainingIds: [] });
    s.loader.request(restructures);
    await flush();
    expect(s.visible()).toEqual({ queryKey: restructures, rows: [], total: 0, remainingCount: 0 });
  });

  it('keeps new search results hidden until the latest query responds', async () => {
    const s = setup();
    const old = deferred<Page>();
    const latest = deferred<Page>();
    const firstQuery = query({ search: 'M', allSheets: true });
    const latestQuery = query({ search: 'Mindy', allSheets: true });
    s.loadInitial.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    s.select(firstQuery);
    s.loader.request(firstQuery);
    s.select(latestQuery);
    expect(s.visible()).toBeNull();
    s.loader.request(latestQuery);
    old.resolve({ success: true, rows: [{ id: 'old-match' }], total: 99, remainingIds: [] });
    await flush();
    expect(s.visible()).toBeNull();
    latest.resolve({ success: true, rows: [{ id: 'Mindy' }], total: 1, remainingIds: [] });
    await flush();
    expect(s.visible()?.rows).toEqual([{ id: 'Mindy' }]);
    expect(s.visible()?.total).toBe(1);
  });
});
