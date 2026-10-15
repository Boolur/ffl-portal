import { afterEach, describe, expect, it, vi } from 'vitest';
import { invalidatePilotReview, peekPilotReview, preloadPilotReview } from './pilotReviewLoader';

afterEach(() => { invalidatePilotReview('test-task'); vi.unstubAllGlobals(); });

describe('document review preloading', () => {
  it('shares an in-flight read and makes the result available before the popup mounts', async () => {
    const result = { success: true, data: { packages: [] } };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', fetcher);
    const first = preloadPilotReview('test-task', 'user:role:version1');
    const second = preloadPilotReview('test-task', 'user:role:version1');
    expect(first).toBe(second);
    await first;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(peekPilotReview('user:role:version1')).toEqual(result);
    expect(peekPilotReview('different-user:role:version1')).toBeNull();
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
  });
  it('discards cached data after a review mutation', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: {} }) });
    vi.stubGlobal('fetch', fetcher);
    await preloadPilotReview('test-task', 'cache');
    invalidatePilotReview('test-task');
    expect(peekPilotReview('cache')).toBeNull();
    await preloadPilotReview('test-task', 'cache');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not cache a denied request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ success: false, error: 'Not authorized' }) });
    vi.stubGlobal('fetch', fetcher);
    await preloadPilotReview('test-task', 'denied');
    expect(peekPilotReview('denied')).toBeNull();
    await preloadPilotReview('test-task', 'denied');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
