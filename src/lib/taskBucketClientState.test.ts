import { describe, expect, it, vi } from 'vitest';
import { appendTaskBucketPage, hasVisibleTaskEditor, TaskBucketRequestGate, withTaskBucketTimeout, type TaskBucketPageState } from './taskBucketClientState';

describe('task bucket request recovery', () => {
  it('releases the edit guard when a completed or routed task leaves its bucket', () => {
    expect(hasVisibleTaskEditor([{ id: 'editing' }], ['editing'])).toBe(true);
    expect(hasVisibleTaskEditor([{ id: 'next-task' }], ['editing', null])).toBe(false);
  });
  it('lets a saved action supersede background work without accepting its late result', () => {
    const gate = new TaskBucketRequestGate();
    gate.setQuery('new', 'view:1');
    const background = gate.begin('new', 'view:1')!;
    gate.supersede('new');
    const saved = gate.begin('new', 'view:1')!;
    expect(gate.isCurrent(background)).toBe(false);
    gate.finish(background, 'Old error');
    expect(gate.isActive('new')).toBe(true);
    expect(gate.isCurrent(saved)).toBe(true);
    expect(gate.errorForView('new', 'view')).toBeNull();
    gate.finish(saved);
  });
  it('bounds hung requests and ignores a late result after timeout', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (value: string) => void;
      const pending = new Promise<string>(done => { resolve = done; });
      const result = withTaskBucketTimeout(pending);
      const rejection = expect(result).rejects.toThrow('This request took too long');
      await vi.advanceTimersByTimeAsync(20_000);
      await rejection;
      resolve('late page');
      await expect(result).rejects.toThrow('This request took too long');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops failed automatic requests and allows one explicit retry', () => {
    const gate = new TaskBucketRequestGate();
    gate.setQuery('new', 'search-a');
    const request = gate.begin('new', 'search-a')!;
    expect(gate.begin('new', 'search-a')).toBeNull();
    gate.finish(request, 'Unable to load tasks');
    expect(gate.error('new', 'search-a')).toBe('Unable to load tasks');
    for (let render = 0; render < 5; render++) expect(gate.begin('new', 'search-a')).toBeNull();
    const retry = gate.begin('new', 'search-a', true)!;
    expect(retry).not.toBeNull();
    expect(gate.begin('new', 'search-a', true)).toBeNull();
    gate.finish(retry);
    expect(gate.error('new', 'search-a')).toBeNull();
  });

  it('ignores stale responses and failures when the search changes', () => {
    const gate = new TaskBucketRequestGate();
    gate.setQuery('new', 'old');
    const old = gate.begin('new', 'old')!;
    gate.setQuery('new', 'latest');
    expect(gate.isCurrent(old)).toBe(false);
    expect(gate.begin('new', 'latest')).toBeNull();
    gate.finish(old, 'Old failure');
    expect(gate.error('new', 'latest')).toBeNull();
    expect(gate.begin('new', 'old', true)).toBeNull();
    const latest = gate.begin('new', 'latest')!;
    expect(gate.isCurrent(latest)).toBe(true);
  });

  it('lets a different search proceed after failure without retrying the failed search', () => {
    const gate = new TaskBucketRequestGate();
    gate.setQuery('new', 'old');
    gate.finish(gate.begin('new', 'old')!, 'Failed');
    gate.setQuery('new', 'latest');
    expect(gate.begin('new', 'latest')).not.toBeNull();
  });
});

function page(ids: string[], count: number, exact: boolean, cursor: string | null): TaskBucketPageState<{ id: string }> {
  return { tasks: ids.map(id => ({ id })), totalCount: count, totalCountIsExact: exact, nextCursor: cursor ? { id: cursor } : null };
}

describe('task bucket scrolling without repeated counts', () => {
  it('retains initial cards and their exact total when a scroll page only returns a lower bound', () => {
    const merged = appendTaskBucketPage(page(['a', 'b'], 40, true, 'b'), page(['c', 'd'], 3, false, 'd'));
    expect(merged.tasks.map(task => task.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(merged.totalCount).toBe(40);
    expect(merged.totalCountIsExact).toBe(true);
  });

  it('keeps a lower bound honest before the initial count arrives', () => {
    const merged = appendTaskBucketPage(page(['a', 'b'], 3, false, 'b'), page(['c', 'd'], 3, false, 'd'));
    expect(merged.totalCount).toBe(5);
    expect(merged.totalCountIsExact).toBe(false);
  });

  it('deduplicates changed pages and settles the total when all matching cards are loaded', () => {
    const merged = appendTaskBucketPage(page(['a', 'b'], 40, true, 'b'), page(['b', 'c'], 2, true, null));
    expect(merged.tasks.map(task => task.id)).toEqual(['a', 'b', 'c']);
    expect(merged.totalCount).toBe(3);
    expect(merged.totalCountIsExact).toBe(true);
    expect(merged.nextCursor).toBeNull();
  });
});
