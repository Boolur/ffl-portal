import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPortalIdentity } from './portalLiveUpdates';
import { clearTaskWorkspaceCache, loadTaskBucketWindow, readTaskWorkspaceCache, taskSeedSignature, taskWorkspaceCacheEpoch, taskWorkspaceKey, writeTaskWorkspaceCache, type TaskWorkspaceSnapshot } from './taskWorkspaceCache';

type Card = { id: string; name?: string };
function snapshot(count = 12): TaskWorkspaceSnapshot<Card> {
  return {
    savedAt: 1000, validatedAt: 900, seedSignature: 'seed', globalSearch: 'Smith', globalSort: 'borrower_asc',
    controlsByBucket: { new: { collapsed: false, search: 'Jane', sort: 'global' } },
    pages: { new: { queryKey: 'scope:search', tasks: Array.from({ length: count }, (_, id) => ({ id: String(id) })), totalCount: 100, totalCountIsExact: true, nextCursor: { id: String(count - 1) } } },
    scrollTopByBucket: { new: 825 },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', {});
  clearTaskWorkspaceCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('Tasks workspace memory', () => {
  it('never reads or writes a server-process snapshot', () => {
    vi.stubGlobal('window', undefined);
    writeTaskWorkspaceCache('server', snapshot());
    expect(readTaskWorkspaceCache('server', 1200)).toBeNull();
    vi.stubGlobal('window', {});
    expect(readTaskWorkspaceCache('server', 1200)).toBeNull();
  });

  it('rejects an oversized JSON window without saving a misleading partial cursor', () => {
    const huge = snapshot(1);
    huge.pages.new.tasks[0].name = 'x'.repeat(8 * 1024 * 1024);
    writeTaskWorkspaceCache('huge', huge);
    expect(readTaskWorkspaceCache('huge', 1200)).toBeNull();
  });

  it('evicts an older workspace when their combined payload exceeds the byte budget', () => {
    const large = snapshot(1);
    large.pages.new.tasks[0].name = 'x'.repeat(5 * 1024 * 1024);
    writeTaskWorkspaceCache('first', large);
    writeTaskWorkspaceCache('second', large);
    expect(readTaskWorkspaceCache('first', 1200)).toBeNull();
    expect(readTaskWorkspaceCache('second', 1200)).not.toBeNull();
  });
  it('restores controls, a deep loaded page, exact counts, cursor and bucket scroll together', () => {
    const saved = snapshot(30);
    writeTaskWorkspaceCache('officer:desk', saved);
    expect(readTaskWorkspaceCache('officer:desk', 1200)).toEqual(saved);
  });

  it('isolates actors, roles and desks and rejects stale cache writes after logout', () => {
    const desk = [{ id: 'new', sectionId: 'processing' }];
    const first = taskWorkspaceKey(JSON.stringify(['alice', 'LOAN_OFFICER', ['LOAN_OFFICER']]), desk);
    const second = taskWorkspaceKey(JSON.stringify(['bob', 'LOAN_OFFICER', ['LOAN_OFFICER']]), desk);
    const roleChange = taskWorkspaceKey(JSON.stringify(['alice', 'MANAGER', ['LOAN_OFFICER', 'MANAGER']]), desk);
    const epoch = taskWorkspaceCacheEpoch();
    writeTaskWorkspaceCache(first, snapshot(), epoch);
    expect(readTaskWorkspaceCache(second, 1200)).toBeNull();
    expect(readTaskWorkspaceCache(roleChange, 1200)).toBeNull();
    resetPortalIdentity();
    writeTaskWorkspaceCache(first, snapshot(), epoch);
    expect(readTaskWorkspaceCache(first, 1200)).toBeNull();
  });

  it('expires snapshots and evicts old workspaces instead of storing partial windows', () => {
    writeTaskWorkspaceCache('old', snapshot());
    expect(readTaskWorkspaceCache('old', 601001)).toBeNull();
    for (let index = 0; index < 9; index++) writeTaskWorkspaceCache(`desk-${index}`, snapshot());
    expect(readTaskWorkspaceCache('desk-0', 1200)).toBeNull();
    expect(readTaskWorkspaceCache('desk-8', 1200)).not.toBeNull();
    writeTaskWorkspaceCache('oversized', snapshot(2001));
    expect(readTaskWorkspaceCache('oversized', 1200)).toBeNull();
  });

  it('detects changed server content even when a task ID is unchanged', () => {
    expect(taskSeedSignature([{ id: 'task', attachments: [] }])).not.toBe(taskSeedSignature([{ id: 'task', attachments: ['proof'] }]));
  });
});

describe('background task-window refresh', () => {
  it('refreshes all previously loaded cards while keeping the final usable cursor and exact total', async () => {
    const records = Array.from({ length: 90 }, (_, id) => ({ id: String(id) }));
    const load = vi.fn(async (cursor: { id: string } | null, size: number) => {
      const start = cursor ? Number(cursor.id) + 1 : 0;
      const tasks = records.slice(start, start + size);
      return { tasks, totalCount: cursor ? tasks.length + 1 : records.length, totalCountIsExact: !cursor,
        nextCursor: start + tasks.length < records.length ? { id: tasks[tasks.length - 1].id } : null };
    });
    const result = await loadTaskBucketWindow(66, load);
    expect(load.mock.calls.map(call => call[1])).toEqual([50, 16]);
    expect(result.tasks).toHaveLength(66);
    expect(result.totalCount).toBe(90);
    expect(result.nextCursor).toEqual({ id: '65' });
  });

  it('settles a queue that shrank and rejects stale work before it can replace the visible window', async () => {
    let current = true;
    const load = vi.fn(async () => {
      current = false;
      return { tasks: [{ id: 'new' }], totalCount: 1, totalCountIsExact: true, nextCursor: null };
    });
    await expect(loadTaskBucketWindow(30, load, () => current)).rejects.toThrow('view changed');
    expect(load).toHaveBeenCalledTimes(1);
    const shortened = await loadTaskBucketWindow(30, load);
    expect(shortened.tasks).toEqual([{ id: 'new' }]);
    expect(shortened.totalCount).toBe(1);
    expect(shortened.nextCursor).toBeNull();
  });
});
