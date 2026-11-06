import { beforeEach, describe, expect, it, vi } from 'vitest';
const { getSummary } = vi.hoisted(() => ({ getSummary: vi.fn() }));
vi.mock('@/app/actions/supportChatActions', () => ({ getMySupportSummary: getSummary }));
import { invalidateSupportSummary, loadSupportSummary } from './supportSummaryLoader';

const summary = { success: true, desks: [], hasAccess: false, unreadCount: 0, chatUnreadCount: 3 };

describe('shared support summary loader', () => {
  beforeEach(() => { invalidateSupportSummary(); getSummary.mockReset(); vi.useRealTimers(); });

  it('coalesces sidebar/widget loads and reuses a fresh summary after navigation', async () => {
    let resolve!: (value: typeof summary) => void;
    getSummary.mockReturnValue(new Promise((done) => { resolve = done; }));
    const sidebar = loadSupportSummary('user:lo');
    const widget = loadSupportSummary('user:lo');
    expect(sidebar).toBe(widget);
    resolve(summary);
    await sidebar;
    expect(await loadSupportSummary('user:lo')).toBe(summary);
    expect(getSummary).toHaveBeenCalledOnce();
  });

  it('refreshes expired, forced, invalidated, and changed-identity summaries', async () => {
    vi.useFakeTimers();
    getSummary.mockResolvedValue(summary);
    await loadSupportSummary('user:lo');
    await vi.advanceTimersByTimeAsync(30_001);
    await loadSupportSummary('user:lo');
    await loadSupportSummary('user:lo', true);
    invalidateSupportSummary();
    await loadSupportSummary('user:lo');
    await loadSupportSummary('user:admin');
    await loadSupportSummary('different-user:lo');
    expect(getSummary).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it('does not cache authorization failures or rejected requests', async () => {
    getSummary.mockResolvedValueOnce({ success: false, error: 'Not authenticated.' })
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(summary);
    await loadSupportSummary('user:lo');
    await expect(loadSupportSummary('user:lo')).rejects.toThrow('offline');
    expect(await loadSupportSummary('user:lo')).toBe(summary);
    expect(getSummary).toHaveBeenCalledTimes(3);
  });

  it('does not restore an old identity cache when an earlier request finishes late', async () => {
    let finishOld!: (value: typeof summary) => void;
    getSummary.mockReturnValueOnce(new Promise((done) => { finishOld = done; })).mockResolvedValue(summary);
    const old = loadSupportSummary('old-user');
    await loadSupportSummary('new-user');
    finishOld(summary);
    await old;
    await loadSupportSummary('new-user');
    expect(getSummary).toHaveBeenCalledTimes(2);
  });
});
