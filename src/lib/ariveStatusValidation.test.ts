import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { ariveSession } from './ariveClient';

const credentials = { clientId: 'synthetic-client-id', secret: 'synthetic-secret-value', apiKey: 'synthetic-api-key' };
const token = 'synthetic-access-token';
afterEach(() => vi.unstubAllGlobals());
async function rejected(body: unknown, path = '/loans/test-guid?sync=true', method: 'PATCH' | null = 'PATCH', status = 400) {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ AccessToken: token }))
    .mockResolvedValueOnce(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetcher);
  const api = await ariveSession(credentials);
  try { await api(path, { loanStages: [] }, method ?? undefined); throw new Error('Expected failure'); }
  catch (error) { expect(fetcher).toHaveBeenCalledTimes(2); return (error as Error).message; }
}
describe('guarded stage HTTP400 validation diagnostics', () => {
  it('reports only the allowed scalar validation message and code', async () => {
    const result = await rejected({ code: 'INVALID_STAGE_DATE', message: 'loanStages[0].stageDate must use MM/DD/YYYY.', request: { secret: 'unknown-hidden-secret' }, stack: 'private-stack' });
    expect(result).toContain('Validation: Code: INVALID_STAGE_DATE. loanStages[0].stageDate must use MM/DD/YYYY.');
    expect(result).not.toContain('unknown-hidden-secret');
    expect(result).not.toContain('private-stack');
  });
  it('accepts error.message but ignores arbitrary nested objects and arrays', async () => {
    expect(await rejected({ error: { message: 'Invalid current stage.', request: { secret: 'unknown-secret' } } })).toContain('Validation: Invalid current stage.');
    for (const body of [{ message: { secret: 'unknown-secret' } }, { errors: [{ message: 'unknown-secret' }] }, [{ message: 'unknown-secret' }], { error: { details: { message: 'unknown-secret' } } }]) {
      const result = await rejected(body);
      expect(result).not.toContain('Validation:'); expect(result).not.toContain('unknown-secret');
    }
  });
  it('redacts known credentials, bearer values, JWTs, URLs, and labeled unknown secrets', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.sig123';
    const unknown = 'unknownLongSecret0123456789abcdef0123456789abcdef';
    const result = await rejected({ message: `Invalid stage ${Object.values(credentials).join(' ')} ${token} Bearer other-token ${jwt} https://example.test/private?key=abcd apiKey=unrecognized-short-key secret:unknown-short-secret ${unknown}` });
    for (const secret of [...Object.values(credentials), token, 'other-token', jwt, 'example.test', 'unrecognized-short-key', 'unknown-short-secret', unknown]) expect(result).not.toContain(secret);
    expect(result).toContain('Invalid stage'); expect(result).toContain('[redacted');
  });
  it('caps diagnostic text and removes stack continuation', async () => {
    expect((await rejected({ message: 'Invalid date.\n at privateFunction (private-path)' }))).not.toContain('privateFunction');
    const result = await rejected({ message: 'date format '.repeat(100) });
    expect(result.split('Validation: ')[1].length).toBeLessThanOrEqual(500);
  });
  it('keeps all other paths, verbs, statuses, and authentication bodies private', async () => {
    for (const [path, method, status] of [['/loans/test-guid/notes', 'PATCH', 400], ['/loans/test-guid', null, 400], ['/loans/test-guid', 'PATCH', 403]] as const) {
      expect(await rejected({ message: 'private-message' }, path, method, status)).not.toContain('private-message');
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ message: 'private-auth-message' }, { status: 400 })));
    await expect(ariveSession(credentials)).rejects.not.toThrow('private-auth-message');
  });
});
