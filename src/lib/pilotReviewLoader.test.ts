import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/app/actions/submissionPilotActions', () => ({ getSubmissionPilot: vi.fn() }));
import { getSubmissionPilot } from '@/app/actions/submissionPilotActions';
import { fetchPilotReview, invalidatePilotReview, peekPilotReview, preloadPilotReview } from './pilotReviewLoader';

afterEach(() => { invalidatePilotReview('test-task'); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('document review preloading', () => {
  it('falls back to the authenticated action when a route redirects to HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, redirected: true, headers: new Headers({ 'content-type': 'text/html' }) }));
    vi.mocked(getSubmissionPilot).mockResolvedValue({ success: false, error: 'Sign in to use the pilot.' });
    expect(await fetchPilotReview('test-task')).toEqual({ success: false, error: 'Sign in to use the pilot.' });
    expect(getSubmissionPilot).toHaveBeenCalledWith('test-task');
  });
  it('falls back when the read transport fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failed')));
    vi.mocked(getSubmissionPilot).mockResolvedValue({ success: false, error: 'Account unavailable.' });
    expect(await fetchPilotReview('test-task')).toEqual({ success: false, error: 'Account unavailable.' });
  });
  it('shares an in-flight read and makes the result available before the popup mounts', async () => {
    const result = { success: true, data: { packages: [] } };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => result });
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
    const fetcher = vi.fn().mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ success: true, data: {} }) });
    vi.stubGlobal('fetch', fetcher);
    await preloadPilotReview('test-task', 'cache');
    invalidatePilotReview('test-task');
    expect(peekPilotReview('cache')).toBeNull();
    await preloadPilotReview('test-task', 'cache');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not cache a denied request', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ success: false, error: 'Not authorized' }) });
    vi.stubGlobal('fetch', fetcher);
    await preloadPilotReview('test-task', 'denied');
    expect(peekPilotReview('denied')).toBeNull();
    expect(getSubmissionPilot).not.toHaveBeenCalled();
    await preloadPilotReview('test-task', 'denied');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
