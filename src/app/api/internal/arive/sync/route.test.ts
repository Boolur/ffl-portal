import { beforeEach, describe, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/arivePipelineSync', () => ({ runDueArivePipelineSyncs: run }));
import { GET } from './route';
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'synthetic-secret'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); run.mockResolvedValue({ checked: 1, succeeded: 1, failed: 0 }); });
describe('Arive scheduled updates', () => {
  it.each([undefined, 'Bearer wrong', 'synthetic-secret'])('rejects an unauthorized request without reading loans', async authorization => {
    const response = await GET(new Request('https://bisuportal.com/api/internal/arive/sync', { headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(401); expect(run).not.toHaveBeenCalled();
  });
  it('never accepts an empty secret', async () => {
    vi.stubEnv('CRON_SECRET', ''); expect((await GET(new Request('https://bisuportal.com/api/internal/arive/sync'))).status).toBe(401);
  });
  it('does not run on preview deployments', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    const response = await GET(new Request('https://bisuportal.com/api/internal/arive/sync', { headers: { authorization: 'Bearer synthetic-secret' } }));
    expect(await response.json()).toMatchObject({ skipped: 'Production schedule only' }); expect(run).not.toHaveBeenCalled();
  });
  it('runs the bounded enabled-file schedule without exposing borrower data', async () => {
    const response = await GET(new Request('https://bisuportal.com/api/internal/arive/sync', { headers: { authorization: 'Bearer synthetic-secret' } }));
    expect(await response.json()).toEqual({ success: true, checked: 1, succeeded: 1, failed: 0 }); expect(run).toHaveBeenCalledOnce();
  });
  it('reports failure for monitoring without exposing upstream exceptions', async () => {
    run.mockRejectedValue(new Error('private detail'));
    const response = await GET(new Request('https://bisuportal.com/api/internal/arive/sync', { headers: { authorization: 'Bearer synthetic-secret' } }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private detail');
  });
});
