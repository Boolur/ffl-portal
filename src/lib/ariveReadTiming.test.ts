import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./ariveClient', () => ({ AriveError: class AriveError extends Error {} }));
import { AriveError } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
import { sampleAriveTestReadTiming } from './ariveReadTiming';

function clock() {
  let time = 0;
  return { now: () => time, advance: (milliseconds: number) => { time += milliseconds; }, sleep: vi.fn(async (milliseconds: number) => { time += milliseconds; }) };
}

describe('bounded synthetic Arive response timing', () => {
  it('performs exactly three sequential read cycles, spaces fast starts, and discards response bodies', async () => {
    const timer = clock(); const starts: number[] = []; let active = 0; let peak = 0;
    const api = vi.fn<(path: string) => Promise<unknown>>(async () => {
      starts.push(timer.now()); peak = Math.max(peak, ++active);
      await Promise.resolve(); timer.advance(50); active--;
      return { borrower: 'PRIVATE BORROWER', secret: 'NEVER RETURN', loanNotes: [{ text: 'PRIVATE NOTE' }] };
    });
    const result = await sampleAriveTestReadTiming(api, 'test-guid', timer);
    expect(result).toMatchObject({ success: true, attemptedRequests: 12, completedRequests: 12, completedCycles: 3, medianRequestMs: 50, p95RequestMs: 50, meanCycleApiMs: 200, elapsedMs: 2800, deadlineReached: false, error: null });
    expect(peak).toBe(1);
    expect(starts).toEqual(Array.from({ length: 12 }, (_, index) => index * 250));
    const cycle = ['/loans/test-guid', '/loans/test-guid/trackers', '/loans/test-guid/notes?limit=100&offset=0', '/loans/test-guid'];
    expect(api.mock.calls.map(call => call[0])).toEqual([...cycle, ...cycle, ...cycle]);
    expect(api.mock.calls.every(call => call.length === 1)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|NEVER RETURN|test-guid/);
    expect(result.limitations).toContain('not a confirmed request allowance');
    expect(result.limitations).toContain('first notes page');
  });

  it('reports request percentiles and cycle API time without including pacing delays', async () => {
    const timer = clock(); const durations = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const api = vi.fn(async () => { timer.advance(durations[api.mock.calls.length - 1]); return {}; });
    const result = await sampleAriveTestReadTiming(api, 'test-guid', timer);
    expect(result).toMatchObject({ medianRequestMs: 6.5, p95RequestMs: 12, meanCycleApiMs: 26, elapsedMs: 2762 });
    expect(result.requestMs).toEqual(durations);
  });

  it.each([
    new AriveError('Arive API request returned HTTP 429. Rate limit reached; try again later.'),
    new AriveTransportError('COOLDOWN', 'Provider cooldown is active.'),
    new AriveError('Arive API request returned HTTP 403.'),
  ])('stops on the first known error without retries or extra requests', async failure => {
    const timer = clock(); const api = vi.fn(async () => { timer.advance(20); return {}; });
    api.mockImplementationOnce(async () => { timer.advance(10); return {}; });
    api.mockImplementationOnce(async () => { throw failure; });
    const result = await sampleAriveTestReadTiming(api, 'test-guid', timer);
    expect(result).toMatchObject({ success: false, attemptedRequests: 2, completedRequests: 1, completedCycles: 0, meanCycleApiMs: null, error: failure.message });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('does not expose unknown exception text or stacks', async () => {
    const api = vi.fn().mockRejectedValue(new Error('secret=PRIVATE; borrower=PRIVATE'));
    const result = await sampleAriveTestReadTiming(api, 'test-guid', clock());
    expect(result).toMatchObject({ success: false, attemptedRequests: 1, completedRequests: 0, medianRequestMs: null, p95RequestMs: null });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('reserves the client timeout and stops before starting work that could exceed its budget', async () => {
    const timer = clock(); const api = vi.fn(async () => { timer.advance(25_000); return {}; });
    const result = await sampleAriveTestReadTiming(api, 'test-guid', timer);
    expect(result).toMatchObject({ success: false, attemptedRequests: 3, completedRequests: 3, elapsedMs: 75_000, deadlineReached: true, error: expect.stringContaining('time limit') });
    expect(api).toHaveBeenCalledTimes(3);
    expect(timer.sleep).not.toHaveBeenCalled();
  });

  it.each(['', '../real-loan', 'test-guid?expand=all', 'x'.repeat(101)])('rejects an invalid test-file identifier before a request (%s)', async guid => {
    const api = vi.fn(); const result = await sampleAriveTestReadTiming(api, guid, clock());
    expect(result).toMatchObject({ success: false, attemptedRequests: 0, completedRequests: 0 });
    expect(api).not.toHaveBeenCalled();
  });
});
