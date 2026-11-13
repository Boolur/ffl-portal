import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ config: vi.fn(), store: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: { ariveIntegrationConfig: { findUnique: m.config } } }));
vi.mock('./ariveTransportPrisma', () => ({ createPrismaAriveTransportStore: m.store, isAriveBudgetReady: vi.fn() }));
vi.mock('./ariveClient', () => ({ AriveError: class extends Error {}, ariveReadOnlySession: vi.fn() }));
import { compareSavedAriveLoanAccess, createAriveDiagnosticFetch, runAriveLoanAccessComparison } from './ariveLoanAccessDiagnostic';
import { AriveTransportError, ariveTransportFingerprint, type AriveRuntime, type AriveRequestReservation, type AriveTransportStore } from './ariveTransport';
import { encryptAriveCredentials } from './ariveCrypto';

const secret = 'synthetic-access-comparison-encryption-secret';
const loan = { id: 'existing-portal-loan', loanNumber: '99999123', borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower', loanOfficer: { email: 'owner@example.test' }, secondaryLoanOfficer: null };
const details = { ariveLoanId: 99999123, sysGUID: 'never-return-provider-guid', loanOriginatorEmail: 'owner@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower', ssn: 'never-return-private-data' }] };
const metadata = { httpStatus: 200, requestId: 'safe-request-id', gatewayCode: null, responseOperation: 'GET' as const };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NEXTAUTH_SECRET', secret); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('loan access comparison orchestration', () => {
  it('compares documented paths without exposing provider names, GUIDs, unrelated loans or borrower search text', async () => {
    const get = vi.fn(async (path: string) => ({ metadata, data: path.includes('?') ? { count: 2, rows: [details, { ...details, ariveLoanId: 88888, loanBorrowers: [{ firstName: 'Never Return Other Borrower' }] }] } : details }));
    const open = vi.fn(async () => ({ metadata, get }));
    const result = await runAriveLoanAccessComparison(loan, open);
    expect(open.mock.calls).toEqual([['SHARED'], ['FRESH']]); expect(get).toHaveBeenCalledTimes(7);
    expect(get.mock.calls[0][0]).toBe('/loans/17881588');
    expect(get.mock.calls[3][0]).toContain('searchField=BORROWER_NAME&searchValue=Synthetic%20Borrower');
    expect(get.mock.calls[4][0]).toBe('/loans/never-return-provider-guid');
    expect(result.steps.filter(step => step.count !== null)).toEqual(expect.arrayContaining([expect.objectContaining({ count: 2, returnedRows: 2, exactLoanIdMatches: 1, identityMatches: true, pageComplete: true })]));
    expect(result.partial).toBe(false);
    for (const excluded of ['never-return', 'Never Return Other Borrower', 'Synthetic Borrower', 'Synthetic%20Borrower', 'owner@example.test']) expect(JSON.stringify(result)).not.toContain(excluded);
  });
  it('does not use a GUID from an unrelated borrower-name result', async () => {
    const get = vi.fn(async (path: string) => ({ metadata, data: path.includes('?') ? { count: 1, rows: [{ ...details, ariveLoanId: 88888 }] } : details }));
    const result = await runAriveLoanAccessComparison(loan, async () => ({ metadata, get }));
    expect(get).toHaveBeenCalledTimes(6); expect(get.mock.calls.some(([path]) => path.includes('never-return-provider-guid'))).toBe(false);
    expect(result.steps.find(step => step.label === 'Target by GUID')).toMatchObject({ outcome: 'NOT_RUN' });
  });
  it('retains full identity failures and distinguishes incomplete search pages', async () => {
    const get = vi.fn(async (path: string) => ({ metadata, data: path.includes('?') ? { count: 1000, rows: [{ ...details, loanOriginatorEmail: 'different@example.test' }] } : { ...details, loanOriginatorEmail: 'different@example.test' } }));
    const result = await runAriveLoanAccessComparison(loan, async () => ({ metadata, get }));
    expect(result.steps.filter(step => step.count !== null).every(step => step.identityMatches === false && step.pageComplete === false)).toBe(true);
    expect(result.steps.find(step => step.label === 'Target by numeric loan number')).toMatchObject({ exactLoanIdMatches: 1, identityMatches: false });
  });
  it('does not guess a GUID when exact searches disagree or return duplicate target IDs', async () => {
    let searches = 0;
    const get = vi.fn(async (path: string) => ({ metadata, data: path.includes('?') ? { count: 1, rows: [{ ...details, sysGUID: `guid-${++searches}` }] } : details }));
    const result = await runAriveLoanAccessComparison(loan, async () => ({ metadata, get }));
    expect(result.steps.find(step => step.label === 'Target by GUID')).toMatchObject({ outcome: 'NOT_RUN', message: expect.stringContaining('inconsistent') });
    expect(get).toHaveBeenCalledTimes(6);
  });
  it('labels invalid search pages instead of treating them as zero matches', async () => {
    const get = vi.fn(async () => ({ metadata, data: { count: -1, rows: [] } }));
    const result = await runAriveLoanAccessComparison(loan, async () => ({ metadata, get }));
    expect(result.partial).toBe(true); expect(result.steps.find(step => step.label === 'Exact DISPLAY_ID target search')).toMatchObject({ outcome: 'INVALID_RESPONSE', count: null, exactLoanIdMatches: null });
  });
  it.each(['COOLDOWN', 'DIAGNOSTIC_LIMIT', 'DIAGNOSTIC_DEADLINE', 'BUDGET_EXHAUSTED'])('stops remaining checks on %s without exposing arbitrary errors', async code => {
    const get = vi.fn(async () => { throw new AriveTransportError(code, 'never-return-sensitive-value'); });
    const open = vi.fn(async () => ({ metadata, get })); const result = await runAriveLoanAccessComparison(loan, open);
    expect(result.partial).toBe(true); expect(get).toHaveBeenCalledTimes(1); expect(open).toHaveBeenCalledTimes(1);
    expect(result.steps.filter(step => step.phase === 'FRESH').every(step => step.outcome === 'NOT_RUN')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('never-return-sensitive-value');
  });
});

describe('hard actual HTTP boundaries', () => {
  it('limits actual GET attempts to eight and authentication attempts to two', async () => {
    const fetcher = vi.fn(async () => Response.json({})); const bounded = createAriveDiagnosticFetch(fetcher as typeof fetch, 200_000, () => 0);
    for (let i = 0; i < 8; i++) await bounded.fetch('https://gwapiconnect.myarive.com/api/loans/1');
    await expect(bounded.fetch('https://gwapiconnect.myarive.com/api/loans/1')).rejects.toMatchObject({ code: 'DIAGNOSTIC_LIMIT' });
    for (let i = 0; i < 2; i++) await bounded.fetch('https://gwapiconnect.myarive.com/api/auth/access-token', { method: 'POST' });
    await expect(bounded.fetch('https://gwapiconnect.myarive.com/api/auth/access-token', { method: 'POST' })).rejects.toMatchObject({ code: 'DIAGNOSTIC_LIMIT' });
    expect(fetcher).toHaveBeenCalledTimes(10); expect(bounded.counts()).toEqual({ getRequests: 8, authenticationRequests: 2 });
  });
  it('blocks writes, other destinations and sends within the last 25 seconds', async () => {
    const fetcher = vi.fn(async () => Response.json({})); let now = 0; const bounded = createAriveDiagnosticFetch(fetcher as typeof fetch, 150_000, () => now);
    await expect(bounded.fetch('https://gwapiconnect.myarive.com/api/loans/1', { method: 'PATCH' })).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(bounded.fetch('https://example.test/loans')).rejects.toMatchObject({ code: 'READ_ONLY' });
    now = 125_000; await expect(bounded.fetch('https://gwapiconnect.myarive.com/api/loans/1')).rejects.toMatchObject({ code: 'DIAGNOSTIC_DEADLINE' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

function productionFixture() {
  const credentials = { clientId: 'private-client', secret: 'private-secret', apiKey: 'private-key' };
  const now = new Date();
  const runtime: AriveRuntime = { id: 'company', enabled: true, providerRequestLimit: 1000, providerWindowSeconds: 60, quotaConfirmedAt: now,
    quotaKeyFingerprint: ariveTransportFingerprint(credentials, secret, 'key'), cooldownUntil: null,
    encryptedAccessToken: encryptAriveCredentials('private-existing-token', secret), accessTokenExpiresAt: new Date(now.getTime() + 3600_000),
    credentialFingerprint: ariveTransportFingerprint(credentials, secret, 'credentials'), refreshLeaseToken: null, refreshLeaseUntil: null };
  const requests: AriveRequestReservation[] = []; const patches: unknown[] = [];
  const store: AriveTransportStore = {
    transaction: async work => work({ runtime: async () => runtime, updateRuntime: async patch => { patches.push(patch); Object.assign(runtime, patch); },
      recentRequests: async () => ({ count: requests.length, oldest: requests[0]?.startedAt ?? null }), activeRequests: async () => requests.filter(row => !row.finishedAt).length,
      createRequest: async row => { requests.push(row); } }),
    finishRequest: async (id, finishedAt, statusCode) => { Object.assign(requests.find(row => row.id === id)!, { finishedAt, statusCode }); },
  };
  m.config.mockResolvedValue({ encryptedCredentials: encryptAriveCredentials(JSON.stringify(credentials), secret) }); m.store.mockReturnValue(store);
  const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/auth/access-token')
    ? Response.json({ AccessToken: 'private-fresh-token', ExpiresIn: 3600 }, { status: 201 })
    : Response.json(String(input).includes('?') ? { count: 1, rows: [details] } : details));
  vi.stubGlobal('fetch', fetcher);
  return { runtime, requests, patches, fetcher, credentials };
}

describe('saved connection diagnostic adapter', () => {
  it('uses the same saved credentials with fully budgeted requests and leaves the shared cache intact during isolated fresh auth', async () => {
    const h = productionFixture(); const original = h.runtime.encryptedAccessToken;
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result).toMatchObject({ partial: false, getRequests: 7, authenticationRequests: 1 });
    expect(h.requests.map(row => row.kind)).toEqual(['GET', 'GET', 'GET', 'GET', 'GET', 'AUTH', 'GET', 'GET']);
    expect(h.runtime.encryptedAccessToken).toBe(original); expect(h.patches).toEqual([]);
    expect(result.steps.find(step => step.method === 'POST')).toMatchObject({ outcome: 'AUTHENTICATED', httpStatus: 201 });
    for (const value of ['private-client', 'private-secret', 'private-key', 'private-existing-token', 'private-fresh-token', 'never-return']) expect(JSON.stringify(result)).not.toContain(value);
  });
  it('counts the ordinary shared GET401/token retry within the same hard budget', async () => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result).toMatchObject({ getRequests: 8, authenticationRequests: 2, partial: false });
    expect(h.requests.filter(row => row.kind === 'AUTH')).toHaveLength(2);
    expect(h.requests.every(row => row.finishedAt)).toBe(true);
  });
  it('returns only allowlisted gateway metadata for denied reads and continues the comparison', async () => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(Response.json({ private: 'never-return-upstream-body' }, { status: 403, headers: { 'x-amzn-requestid': 'safe-request-123', 'x-amzn-errortype': 'ForbiddenException:extra', authorization: 'private-secret' } }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.steps[0]).toMatchObject({ outcome: 'ERROR', httpStatus: 403, requestId: 'safe-request-123', gatewayCode: 'ForbiddenException', message: 'Arive loan read returned HTTP 403.' });
    expect(result.partial).toBe(false);
    expect(result.steps.some(step => step.phase === 'FRESH' && step.outcome === 'READ')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('never-return-upstream-body'); expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it.each([403, 404])('treats a completed HTTP%s denial/not-found read as access evidence', async status => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(new Response('', { status }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.partial).toBe(false); expect(result.steps[0]).toMatchObject({ outcome: 'ERROR', httpStatus: status });
  });
  it.each([500, 502, 503, 408, 429])('marks transient HTTP%s read failures as partial rather than complete access evidence', async status => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(new Response('', { status }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.partial).toBe(true); expect(result.steps[0]).toMatchObject({ outcome: 'ERROR', httpStatus: status });
  });
  it('marks a timeout without an HTTP response as a partial comparison', async () => {
    const h = productionFixture(); h.fetcher.mockRejectedValueOnce(new DOMException('Sensitive transport timeout details', 'TimeoutError'));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.partial).toBe(true); expect(result.steps[0]).toMatchObject({ outcome: 'ERROR', httpStatus: null });
    expect(JSON.stringify(result)).not.toContain('Sensitive transport');
  });
  it('suppresses credential and token values even if reflected in a syntactically valid request-ID header', async () => {
    const h = productionFixture();
    h.fetcher.mockImplementation(async (input: string | URL | Request) => String(input).endsWith('/auth/access-token')
      ? Response.json({ AccessToken: 'private-fresh-token', ExpiresIn: 3600 }, { status: 201, headers: { 'x-amzn-requestid': 'private-fresh-token' } })
      : Response.json(String(input).includes('?') ? { count: 1, rows: [details] } : details, { headers: { 'x-amzn-requestid': 'private-existing-token' } }));
    h.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403, headers: { 'x-amzn-requestid': 'private-secret' } }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.steps.every(step => step.requestId === null)).toBe(true);
    for (const value of ['private-secret', 'private-fresh-token', 'private-existing-token']) expect(JSON.stringify(result)).not.toContain(value);
  });
  it.each(['secret', 'apiKey'])('aborts on saved %s rotation during shared refresh without caching the old-credential token', async field => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    h.fetcher.mockImplementation(async () => {
      m.config.mockResolvedValue({ encryptedCredentials: encryptAriveCredentials(JSON.stringify({ ...h.credentials, [field]: 'rotated-value' }), secret) });
      return Response.json({ AccessToken: 'old-credentials-issued-token', ExpiresIn: 3600 }, { status: 201 });
    });
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result).toMatchObject({ partial: true, getRequests: 1, authenticationRequests: 1 });
    expect(h.runtime.encryptedAccessToken).toBeNull();
    expect(h.patches.every(patch => !('encryptedAccessToken' in (patch as Record<string, unknown>)) || (patch as Record<string, unknown>).encryptedAccessToken === null)).toBe(true);
    expect(result.steps.filter(step => step.phase === 'FRESH').every(step => step.outcome === 'NOT_RUN')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('old-credentials-issued-token');
  });
  it('does not attach stale authentication201 metadata when shared request admission stops the following GET', async () => {
    const h = productionFixture(); h.runtime.encryptedAccessToken = null;
    h.fetcher.mockImplementation(async () => { h.runtime.providerRequestLimit = 2; return Response.json({ AccessToken: 'private-new-token', ExpiresIn: 3600 }, { status: 201, headers: { 'x-amzn-requestid': 'auth-request-201' } }); });
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result).toMatchObject({ partial: true, getRequests: 0, authenticationRequests: 1 });
    expect(result.steps[0]).toMatchObject({ method: 'GET', outcome: 'ERROR', httpStatus: null, requestId: null, responseOperation: null });
    expect(JSON.stringify(result.steps[0])).not.toContain('201');
  });
  it('identifies an authentication denial during a shared GET refresh as authentication evidence', async () => {
    const h = productionFixture(); h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response('', { status: 403, headers: { 'x-amzn-requestid': 'auth-denied-123' } }));
    const result = await compareSavedAriveLoanAccess(loan);
    expect(result.steps[0]).toMatchObject({ method: 'GET', outcome: 'ERROR', responseOperation: 'AUTH', httpStatus: 403, message: 'Arive authentication returned HTTP 403.' });
    expect(result.partial).toBe(true);
  });
});
