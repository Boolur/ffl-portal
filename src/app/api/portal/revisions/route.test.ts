import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ token: vi.fn(), revisions: vi.fn() }));
vi.mock('next-auth/jwt', () => ({ getToken: mocks.token }));
vi.mock('@/lib/portalRevisionQueries', () => ({ getPortalRevisions: mocks.revisions }));
vi.mock('@/lib/pipelinePilot', async () => import('../../../../lib/pipelinePilot'));
import { GET } from './route';

const request = (topic = 'tasks') => new NextRequest(`https://portal.example.test/api/portal/revisions?topic=${topic}`);

describe('portal revision read boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token.mockResolvedValue({ id: 'viewer', role: 'LOAN_OFFICER' });
    mocks.revisions.mockResolvedValue({ overview: 'overview-hash', tasks: 'tasks-hash', pipeline: 'pipeline-hash' });
  });

  it.each([null, {}, { role: 'ADMIN_III' }])('rejects absent identity before reading markers', async token => {
    mocks.token.mockResolvedValue(token);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.revisions).not.toHaveBeenCalled();
  });

  it.each(['ONBOARDING', 'QC', 'VA', 'VA_TITLE', 'VA_PAYOFF', 'VA_APPRAISAL', 'VA_HOI', 'UNKNOWN'])('denies the %s role', async role => {
    mocks.token.mockResolvedValue({ id: 'viewer', role });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.revisions).not.toHaveBeenCalled();
  });

  it('uses active-role restrictions even when the primary role is admin', async () => {
    mocks.token.mockResolvedValue({ id: 'viewer', role: 'ADMIN_III', activeRole: 'DISCLOSURE_SPECIALIST' });
    expect((await GET(request('pipeline'))).status).toBe(403);
    expect(mocks.revisions).not.toHaveBeenCalled();
    expect((await GET(request('tasks'))).status).toBe(200);
  });

  it.each(['overview', 'tasks', 'pipeline'])('returns only the requested %s marker with private no-store headers', async topic => {
    const response = await GET(request(topic));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ topic, revision: `${topic}-hash` });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it.each(['', 'users', 'pipeline,overview', '../tasks'])('rejects invalid topic %s before reading markers', async topic => {
    expect((await GET(request(topic))).status).toBe(400);
    expect(mocks.revisions).not.toHaveBeenCalled();
  });

  it('does not expose database errors or connection information', async () => {
    mocks.revisions.mockRejectedValue(new Error('connection postgres://private-secret@example.test failed'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Updates are temporarily unavailable.' });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});
