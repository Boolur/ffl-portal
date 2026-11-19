import { afterEach, describe, expect, it, vi } from 'vitest';
const { worker } = vi.hoisted(() => ({ worker: vi.fn() }));
vi.mock('@/lib/ariveLeadershipPilotWorker', () => ({ runLeadershipPilotCollection: worker }));
import { GET } from './route';

const url = 'https://example.test/api/internal/arive/leadership-pilot';
afterEach(() => { vi.unstubAllEnvs(); worker.mockReset(); });
describe('leadership collection route', () => {
  it.each(['', 'Bearer invalid'])('refuses a request without the scheduled credential', async authorization => {
    vi.stubEnv('CRON_SECRET', 'fixture-scheduler');
    const response = await GET(new Request(url, { headers: { authorization } }));
    expect(response.status).toBe(401);
    expect(worker).not.toHaveBeenCalled();
  });
  it('runs collection on an authenticated production tick', async () => {
    vi.stubEnv('CRON_SECRET', 'fixture-scheduler'); vi.stubEnv('VERCEL_ENV', 'production');
    worker.mockResolvedValue({ verified: 1 });
    const response = await GET(new Request(url, { headers: { authorization: 'Bearer fixture-scheduler' } }));
    expect(await response.json()).toEqual({ verified: 1 });
    expect(worker).toHaveBeenCalledOnce();
  });
});
