import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JWT } from 'next-auth/jwt';

const mocks = vi.hoisted(() => ({ findUser: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
vi.mock('@/lib/loginAudit', async () => import('./loginAudit'));
vi.mock('@/lib/requestContext', async () => import('./requestContext'));
import { authOptions } from './auth';
import { CURRENT_SESSION_GENERATION, decodePortalSession } from './sessionGeneration';

const jwtCallback = authOptions.callbacks!.jwt!;
type CallbackInput = Parameters<typeof jwtCallback>[0];
const runCallback = (input: Partial<CallbackInput>) => jwtCallback(input as CallbackInput);

describe('session reset during authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUser.mockResolvedValue({ role: 'LOAN_OFFICER', roles: ['LOAN_OFFICER'], name: 'Viewer', active: true });
  });

  it('uses the generation decoder for server sessions and the session endpoint', () => {
    expect(authOptions.jwt?.decode).toBe(decodePortalSession);
  });

  it('issues the current generation after a successful sign-in', async () => {
    const token = await runCallback({ token: {}, user: { id: 'viewer', name: 'Viewer' }, trigger: 'signIn' });
    expect(token.id).toBe('viewer');
    expect(token.sessionGeneration).toBe(CURRENT_SESSION_GENERATION);
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  it('keeps new sessions valid when refreshed', async () => {
    const token: JWT = { id: 'viewer', role: 'LOAN_OFFICER', sessionGeneration: CURRENT_SESSION_GENERATION, dbSyncedAt: Date.now() };
    expect((await runCallback({ token })).sessionGeneration).toBe(CURRENT_SESSION_GENERATION);
  });

  it('cannot upgrade an old session through client-supplied session updates', async () => {
    const token: JWT = { id: 'viewer', role: 'LOAN_OFFICER', dbSyncedAt: Date.now() };
    const updated = await runCallback({ token, trigger: 'update', session: { activeRole: 'LOAN_OFFICER', sessionGeneration: CURRENT_SESSION_GENERATION } });
    expect(updated.sessionGeneration).toBeUndefined();
  });
});
