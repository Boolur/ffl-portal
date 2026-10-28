import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
const mocks = vi.hoisted(() => ({ session: vi.fn(), findUser: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.findUser } } }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveCrypto', async () => import('../../lib/ariveCrypto'));
vi.mock('@/lib/ariveClient', async () => import('../../lib/ariveClient'));
vi.mock('@/lib/ariveDiagnostics', async () => import('../../lib/ariveDiagnostics'));
import { runAriveCredentialDiagnostic, runAriveEgressDiagnostic } from './ariveDiagnosticActions';

const credentials = { clientId: 'synthetic-client', secret: 'synthetic-secret', apiKey: 'synthetic-api' };
function comparisonCode(values = credentials) {
  const challenge = 'a'.repeat(64);
  const fingerprint = (name: string, value: string) => createHmac('sha256', Buffer.from(challenge, 'hex')).update(JSON.stringify(['arive-diagnostic-v1', name, value])).digest('hex');
  return JSON.stringify({ version: 1, challenge, fingerprints: {
    clientId: fingerprint('clientId', values.clientId), secret: fingerprint('secret', values.secret), apiKey: fingerprint('apiKey', values.apiKey), request: fingerprint('request', JSON.stringify(values)),
  } });
}
const input = () => ({ ...credentials, comparisonCode: comparisonCode() });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III' } });
  mocks.findUser.mockResolvedValue({ active: true, role: 'ADMIN_III', roles: ['ADMIN_III'] });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('155.121.192.4\n'))));
});
afterEach(() => vi.unstubAllGlobals());

describe('Arive diagnostic authorization', () => {
  it.each(['no session', 'inactive', 'missing user', 'unassigned role', 'lower admin', 'active LO'] as const)('denies %s before any outbound request', async scenario => {
    if (scenario === 'no session') mocks.session.mockResolvedValue(null);
    if (scenario === 'inactive') mocks.findUser.mockResolvedValue({ active: false, role: 'ADMIN_III', roles: ['ADMIN_III'] });
    if (scenario === 'missing user') mocks.findUser.mockResolvedValue(null);
    if (scenario === 'unassigned role') mocks.findUser.mockResolvedValue({ active: true, role: 'LOAN_OFFICER', roles: ['LOAN_OFFICER'] });
    if (scenario === 'lower admin') { mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_II' } }); mocks.findUser.mockResolvedValue({ active: true, role: 'ADMIN_II', roles: ['ADMIN_II'] }); }
    if (scenario === 'active LO') { mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III', activeRole: 'LOAN_OFFICER' } }); mocks.findUser.mockResolvedValue({ active: true, role: 'ADMIN_III', roles: ['ADMIN_III', 'LOAN_OFFICER'] }); }
    expect((await runAriveEgressDiagnostic()).success).toBe(false);
    expect((await runAriveCredentialDiagnostic(input())).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows a valid active Admin III role held as a secondary role', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'LOAN_OFFICER', activeRole: 'ADMIN_III' } });
    mocks.findUser.mockResolvedValue({ active: true, role: 'LOAN_OFFICER', roles: ['ADMIN_III'] });
    expect((await runAriveEgressDiagnostic()).success).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('never returns unexpected authentication/database errors containing private details', async () => {
    mocks.findUser.mockRejectedValue(new Error('PRIVATE_DATABASE_DETAILS'));
    const result = await runAriveCredentialDiagnostic(input());
    expect(result).toEqual({ success: false, error: 'Unable to complete the Arive diagnostic.' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('paired authentication diagnostic', () => {
  it('skips Arive entirely on a mismatch but still reports the same invocation egress', async () => {
    const result = await runAriveCredentialDiagnostic({ ...input(), secret: 'different' });
    expect(result).toMatchObject({ success: true, data: { matches: { clientId: true, secret: false, apiKey: true, request: false }, authentication: { attempted: false, ok: false }, egress: { samples: expect.any(Array) } } });
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(fetch).mock.calls) expect(call[0]).toBe('https://checkip.amazonaws.com');
    expect(JSON.stringify(result)).not.toContain(credentials.secret);
    expect(JSON.stringify(result)).not.toContain('fingerprints');
  });
  it('accepts a genuine mocked HTTP201 from the actual client once, then samples egress without calling any loan endpoint', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ AccessToken: 'PRIVATE_ACCESS_TOKEN', ExpiresIn: 3600, TokenType: 'Bearer' }, { status: 201 }));
    const result = await runAriveCredentialDiagnostic({ ...input(), clientId: ` ${credentials.clientId} `, secret: ` ${credentials.secret} `, apiKey: ` ${credentials.apiKey} ` });
    expect(result).toMatchObject({ success: true, data: { matches: { clientId: true, secret: true, apiKey: true, request: true }, authentication: { attempted: true, ok: true } } });
    expect(fetch).toHaveBeenCalledTimes(4);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://gwapiconnect.myarive.com/api/auth/access-token');
    expect(options?.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-KEY': credentials.apiKey });
    expect(JSON.parse(options?.body as string)).toEqual(credentials);
    for (const call of vi.mocked(fetch).mock.calls.slice(1)) expect(call[0]).toBe('https://checkip.amazonaws.com');
    const serialized = JSON.stringify(result);
    for (const value of [...Object.values(credentials), 'PRIVATE_ACCESS_TOKEN', comparisonCode()]) expect(serialized).not.toContain(value);
  });
  it('returns allowlisted gateway diagnostics on403 but never upstream body or secrets', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('PRIVATE_PROVIDER_BODY', { status: 403, headers: { 'x-amzn-errortype': 'ForbiddenException', 'x-amzn-requestid': '12345678-abcd-4321-abcd-123456789012' } }));
    const result = await runAriveCredentialDiagnostic(input());
    expect(result).toMatchObject({ success: true, data: { authentication: { attempted: true, ok: false, message: expect.stringContaining('Gateway code: ForbiddenException. Request ID: 12345678-abcd-4321-abcd-123456789012.') } } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_BODY');
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it.each(['<redacted>', '••••••', '********', 'bad\nkey'])('rejects %s before authentication or egress calls', async apiKey => {
    const result = await runAriveCredentialDiagnostic({ ...input(), apiKey });
    expect(result.success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects invalid comparison codes without network activity', async () => {
    expect((await runAriveCredentialDiagnostic({ ...input(), comparisonCode: '{}' })).success).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
