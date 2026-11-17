import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: vi.fn(), store: vi.fn(), enabled: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: { ariveIntegrationConfig: { findUnique: mocks.config } } }));
vi.mock('./ariveTransportPrisma', () => ({ createPrismaAriveTransportStore: mocks.store, sharedAriveTransportEnabled: mocks.enabled, isAriveBudgetReady: vi.fn() }));
vi.mock('./ariveClient', () => ({ AriveError: class AriveError extends Error {}, ariveReadOnlySession: vi.fn() }));
import { AriveActiveDiagnosticGuardError, runAriveActivePipelineDiagnosticChunk, type AriveActiveDiagnosticLoan } from './ariveActivePipelineDiagnostic';
import { ariveTransportFingerprint, type AriveRuntime, type AriveRequestReservation, type AriveTransportStore } from './ariveTransport';
import { encryptAriveCredentials } from './ariveCrypto';

const secret = 'synthetic-active-diagnostic-encryption-secret';
const loan: AriveActiveDiagnosticLoan = { id: 'loan-1', pipelineId: 'pipeline-1', version: 2, loanNumber: '99999123',
  borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower',
  loanOfficer: { email: 'owner@example.test' }, secondaryLoanOfficer: null, savedGuid: 'private-guid-1', savedOriginatorEmail: 'owner@example.test' };
const details = { ariveLoanId: 99999123, sysGUID: 'private-guid-1', loanOriginatorEmail: 'owner@example.test',
  loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower', ssn: 'never-return-ssn' }], financialDetails: 'never-return-financials' };
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NEXTAUTH_SECRET', secret); mocks.enabled.mockReturnValue(true); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function fixture() {
  const now = new Date(); const credentials = { clientId: 'private-client', secret: 'private-secret', apiKey: 'private-api-key' };
  const config = { updatedAt: now, encryptedCredentials: encryptAriveCredentials(JSON.stringify(credentials), secret) };
  mocks.config.mockImplementation(async () => config);
  const runtime: AriveRuntime = { id: 'company', enabled: true, providerRequestLimit: 1000, providerWindowSeconds: 60,
    quotaConfirmedAt: now, quotaKeyFingerprint: ariveTransportFingerprint(credentials, secret, 'key'), cooldownUntil: null,
    encryptedAccessToken: encryptAriveCredentials('private-cached-token', secret), accessTokenExpiresAt: new Date(now.getTime() + 3600_000),
    credentialFingerprint: ariveTransportFingerprint(credentials, secret, 'credentials'), refreshLeaseToken: null, refreshLeaseUntil: null };
  const requests: AriveRequestReservation[] = []; const patches: unknown[] = [];
  const store: AriveTransportStore = {
    transaction: async fn => fn({ runtime: async () => runtime, updateRuntime: async patch => { patches.push(patch); Object.assign(runtime, patch); },
      recentRequests: async () => ({ count: requests.length, oldest: requests[0]?.startedAt ?? null }), activeRequests: async () => requests.filter(r => !r.finishedAt).length,
      createRequest: async row => { requests.push(row); } }),
    finishRequest: async (id, finishedAt, statusCode) => { Object.assign(requests.find(r => r.id === id)!, { finishedAt, statusCode }); },
  };
  mocks.store.mockReturnValue(store);
  const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes('/auth/') ? Response.json({ AccessToken: 'private-new-token', ExpiresIn: 3600 })
    : Response.json(String(url).includes('?') ? { count: 1, rows: [details] } : details));
  vi.stubGlobal('fetch', fetcher);
  const guard = vi.fn(async () => {});
  const input = { loans: [loan], credentialRevision: now.toISOString(), guard };
  return { now, config, runtime, requests, patches, fetcher, guard, input };
}

describe('active pipeline read-only diagnostic', () => {
  it('verifies exact search and GUID detail with saved identity, returning only minimized evidence', async () => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 1, getRequests: 2, authenticationRequests: 0, invalidated: false, deferred: null,
      results: [{ pipelineId: loan.pipelineId, version: 2, status: 'VERIFIED', phase: 'DETAIL', apiVisible: true, searchIdentity: true, detailIdentity: true, httpStatus: 200 }] });
    expect(h.fetcher.mock.calls.map(([url]) => url)).toEqual([
      'https://gwapiconnect.myarive.com/api/loans?searchField=DISPLAY_ID&searchValue=99999123&limit=100&offset=0',
      'https://gwapiconnect.myarive.com/api/loans/private-guid-1',
    ]);
    for (const excluded of ['private-', 'never-return', 'Synthetic Borrower', 'owner@example.test', 'financialDetails']) expect(JSON.stringify(result)).not.toContain(excluded);
    expect(h.requests.every(r => r.kind === 'GET' && r.finishedAt)).toBe(true);
  });
  it.each([
    [{ ...loan, loanNumber: 'unknown' }, 'INVALID_LOAN_NUMBER'],
    [{ ...loan, duplicateNumericId: true }, 'DUPLICATE_PORTAL_NUMBER'],
    [{ ...loan, practice: true }, 'PRACTICE_EXCLUDED'],
  ] as const)('does not send requests for a local exception: %s', async (row, status) => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, loans: [row] });
    expect(result.results[0]).toMatchObject({ status, phase: 'INPUT' }); expect(h.fetcher).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0);
  });
  it('does not verify either side of a duplicate numeric ID within the chunk', async () => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, loans: [loan, { ...loan, pipelineId: 'pipeline-2' }] });
    expect(result.results.map(r => r.status)).toEqual(['DUPLICATE_PORTAL_NUMBER', 'DUPLICATE_PORTAL_NUMBER']); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    [{ count: 0, rows: [] }, 'NO_API_MATCH', false],
    [{ count: 1, rows: [{ ...details, ariveLoanId: 88888 }] }, 'NO_API_MATCH', false],
    [{ count: 2, rows: [details, details] }, 'AMBIGUOUS_API_MATCH', true],
    [{ count: 2, rows: [details] }, 'INVALID_RESPONSE', null],
    [{ count: -1, rows: [] }, 'INVALID_RESPONSE', null],
    [{ count: 1, rows: [{ ...details, sysGUID: '' }] }, 'INVALID_RESPONSE', true],
  ] as const)('rejects empty, ambiguous or incomplete provider results without guessing a detail ID', async (response, status, apiVisible) => {
    const h = fixture(); h.fetcher.mockImplementation(async () => Response.json(response));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result.results[0]).toMatchObject({ status, apiVisible, detailIdentity: null }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not follow a GUID that differs from the saved permanent identity', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async () => Response.json({ count: 1, rows: [{ ...details, sysGUID: 'other-guid' }] }));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result.results[0]).toMatchObject({ status: 'IDENTITY_MISMATCH', identityIssue: 'LOAN_NUMBER_OR_GUID', detailIdentity: null }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([
    [{ ...details, ariveLoanId: 88888 }, 'LOAN_NUMBER_OR_GUID'],
    [{ ...details, sysGUID: 'other-guid' }, 'LOAN_NUMBER_OR_GUID'],
    [{ ...details, loanOriginatorEmail: 'other@example.test' }, 'ORIGINATOR'],
    [{ ...details, loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Different', lastName: 'Borrower' }] }, 'BORROWER_NAME'],
  ] as const)('requires strict detail identity even after an exact successful search', async (changed, identityIssue) => {
    const h = fixture(); h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 1, rows: [details] } : changed));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result.results[0]).toMatchObject({ status: 'IDENTITY_MISMATCH', searchIdentity: true, detailIdentity: false, identityIssue });
  });
  it('keeps an inconsistent search identity unresolved even if later details pass', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 1, rows: [{ ...details, loanOriginatorEmail: 'other@example.test' }] } : details));
    expect((await runAriveActivePipelineDiagnosticChunk(h.input)).results[0]).toMatchObject({ status: 'IDENTITY_MISMATCH', searchIdentity: false, detailIdentity: true, identityIssue: 'ORIGINATOR' });
  });
  it('preserves a known synthetic classification rather than treating it as a real file', async () => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, loans: [{ ...loan, synthetic: true }] });
    expect(result.results[0]).toMatchObject({ status: 'VERIFIED', synthetic: true });
  });
  it.each([400, 403, 404, 422])('reports loan HTTP %s separately from identity failure', async status => {
    const h = fixture(); h.fetcher.mockImplementation(async () => Response.json({ private: 'never-return-secret' }, { status, headers: { 'x-amzn-errortype': 'ForbiddenException' } }));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 1, invalidated: false, deferred: null, results: [{ status: 'HTTP_ERROR', httpStatus: status, detailIdentity: null, identityIssue: null }] });
    expect(JSON.stringify(result)).not.toContain('never-return-secret');
  });
});

describe('explicit follow-up evidence', () => {
  it('explains all identity differences without weakening the production matcher or retaining unrelated data', async () => {
    const h = fixture(); const changed = { ...details, loanOriginatorEmail: 'primary@example.test',
      loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Other', lastName: 'Borrower', ssn: 'never-return-ssn' }],
      loanTeam: [{ emailAddressText: loan.loanOfficer.email, loanRole: 'Loan Officer', primary: false, mobilePhone10digit: 'never-return-phone' }] };
    h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 1, rows: [changed] } : changed));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true });
    expect(result.results[0]).toMatchObject({ status: 'IDENTITY_MISMATCH', evidence: {
      portal: { primaryOriginatorEmail: loan.loanOfficer.email }, detail: { originatorEmail: 'primary@example.test',
        borrowers: ['Other Borrower'], issues: ['ORIGINATOR', 'SAVED_ORIGINATOR', 'BORROWER_NAME'],
        team: [{ email: loan.loanOfficer.email, role: 'Loan Officer', primary: false }] } } });
    expect(JSON.stringify(result)).not.toContain('never-return');
    expect(h.requests).toHaveLength(2);
  });
  it('distinguishes empty numeric search, denied numeric detail and a different borrower-name candidate', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async url => String(url).includes('DISPLAY_ID') ? Response.json({ count: 0, rows: [] })
      : String(url).includes('BORROWER_NAME') ? Response.json({ count: 1, rows: [{ ...details, ariveLoanId: 99999456 }] })
        : Response.json({}, { status: 403, headers: { 'x-amzn-requestid': 'request-12345678', 'x-amzn-errortype': 'ForbiddenException' } }));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true });
    expect(result).toMatchObject({ consumed: 1, getRequests: 3, deferred: null, results: [{ status: 'NO_API_MATCH', phase: 'SEARCH', httpStatus: 200,
      evidence: { numericProbe: { httpStatus: 403, requestId: 'request-12345678' }, borrowerSearch: { count: 1, complete: true, candidatesTruncated: false,
        candidates: [{ loanNumber: '99999456', issues: ['LOAN_NUMBER'] }] } } }] });
    expect(result.results[0].evidence!.borrowerSearch!.candidates[0].loanNumber).not.toBe(loan.loanNumber);
  });
  it('searches a borrower for an invalid ID without sending that invalid ID to a detail endpoint', async () => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true, loans: [{ ...loan, loanNumber: 'TBD' }] });
    expect(result).toMatchObject({ getRequests: 1, consumed: 1, results: [{ status: 'INVALID_LOAN_NUMBER', evidence: { borrowerSearch: { count: 1 } } }] });
    expect(h.fetcher.mock.calls.every(([url]) => String(url).includes('BORROWER_NAME'))).toBe(true);
  });
  it('bounds alternate candidates and identifies an incomplete search page without following candidate GUIDs', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async () => Response.json({ count: 25, rows: Array.from({ length: 20 }, (_, index) => ({ ...details, ariveLoanId: 90000 + index })) }));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true, loans: [{ ...loan, loanNumber: 'TBD' }] });
    expect(result.results[0].evidence!.borrowerSearch).toMatchObject({ count: 25, complete: false, candidatesTruncated: true });
    expect(result.results[0].evidence!.borrowerSearch!.candidates).toHaveLength(10); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('preserves the missing-search exception when the numeric detail is accessible', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 0, rows: [] } : details));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true });
    expect(result.results[0]).toMatchObject({ status: 'NO_API_MATCH', evidence: { numericProbe: { httpStatus: 200, identity: { issues: [] } } } });
  });
  it('does not retain secrets if the provider echoes them inside identity or request-ID fields', async () => {
    const h = fixture(); const echoed = { ...details, loanOriginatorEmail: 'private-api-key', loanTeam: [{ emailAddressText: 'private-cached-token', loanRole: 'private-secret' }] };
    h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 1, rows: [echoed] } : echoed,
      { headers: { 'x-amzn-requestid': 'private-client' } }));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true });
    expect(result.results[0].requestId).toBeNull();
    for (const excluded of ['private-api-key', 'private-cached-token', 'private-secret', 'private-client', 'never-return']) expect(JSON.stringify(result)).not.toContain(excluded);
  });
  it('honors pause races and shared throttling during alternate probes', async () => {
    const h = fixture(); let paused = false;
    h.guard.mockImplementation(async () => { if (paused) throw new AriveActiveDiagnosticGuardError('CONTROL_CHANGED'); });
    h.fetcher.mockImplementation(async url => { if (!String(url).includes('?')) paused = true; return Response.json({ count: 0, rows: [] }); });
    expect(await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true })).toMatchObject({ invalidated: true, results: [], getRequests: 2 });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it('keeps explanatory borrower checks consistent with normalized fallback names and all applicant rows', async () => {
    const h = fixture(); const many = { ...details, loanBorrowers: [
      ...Array.from({ length: 8 }, () => ({ applicantType: 'Borrower', firstName: 'Another', lastName: 'Person' })),
      details.loanBorrowers[0], { applicantType: 'CoBorrower', firstName: 'Second', lastName: 'Applicant' },
    ] };
    h.fetcher.mockImplementation(async url => Response.json(String(url).includes('?') ? { count: 1, rows: [many] } : many));
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, investigate: true, loans: [{ ...loan, borrowerFirstName: '  ' }] });
    expect(result.results[0]).toMatchObject({ status: 'VERIFIED', evidence: { portal: { borrowerName: loan.borrowerName },
      detail: { issues: [], otherApplicants: [{ name: 'Second Applicant', applicantType: 'CoBorrower' }] } } });
    expect(result.results[0].evidence!.detail!.borrowers).toHaveLength(8);
  });
});

describe('shared limits and fail-closed binding', () => {
  it('will not use a rotated connection revision', async () => {
    const h = fixture(); const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, credentialRevision: new Date(h.now.getTime() - 1).toISOString() });
    expect(result).toMatchObject({ consumed: 0, invalidated: true, deferred: { code: 'CREDENTIALS_CHANGED' } }); expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('invalidates a result when credentials rotate while a provider read is in flight', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async () => { h.config.updatedAt = new Date(h.now.getTime() + 1); return Response.json({ count: 1, rows: [details] }); });
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ results: [], consumed: 0, getRequests: 1, invalidated: true, deferred: { code: 'CREDENTIALS_CHANGED' } }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['CONTROL_CHANGED', 'ACCESS_CHANGED', 'SOURCE_CHANGED', 'LEASE_LOST', 'EXPIRED'] as const)('discards in-flight evidence when guard reports %s', async code => {
    const h = fixture(); let changed = false;
    h.guard.mockImplementation(async () => { if (changed) throw new AriveActiveDiagnosticGuardError(code); });
    h.fetcher.mockImplementation(async () => { changed = true; return Response.json({ count: 1, rows: [details] }); });
    expect(await runAriveActivePipelineDiagnosticChunk(h.input)).toMatchObject({ results: [], consumed: 0, invalidated: true, deferred: { code } });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks the guard again before authentication after a GET401', async () => {
    const h = fixture(); let blocked = false;
    h.guard.mockImplementation(async () => { if (blocked) throw new AriveActiveDiagnosticGuardError('CONTROL_CHANGED'); });
    h.fetcher.mockImplementation(async () => { blocked = true; return Response.json({}, { status: 401 }); });
    expect(await runAriveActivePipelineDiagnosticChunk(h.input)).toMatchObject({ invalidated: true, getRequests: 1, authenticationRequests: 0 }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('checks control changes after a failed HTTP read before accepting its loan outcome', async () => {
    const h = fixture(); let changed = false;
    h.guard.mockImplementation(async () => { if (changed) throw new AriveActiveDiagnosticGuardError('CONTROL_CHANGED'); });
    h.fetcher.mockImplementation(async () => { changed = true; return Response.json({}, { status: 403 }); });
    expect(await runAriveActivePipelineDiagnosticChunk(h.input)).toMatchObject({ consumed: 0, results: [], invalidated: true, deferred: { code: 'CONTROL_CHANGED' } });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['guard', 'connection'] as const)('awaits both parallel checks before sending when %s is slower', async slow => {
    const h = fixture(); let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    // Initialization performs one guard and one configuration read. Block the
    // next combined check and prove neither branch can let a send through early.
    if (slow === 'guard') h.guard.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => pending);
    else mocks.config.mockResolvedValueOnce(h.config).mockImplementationOnce(async () => { await pending; return h.config; });
    const run = runAriveActivePipelineDiagnosticChunk(h.input);
    await vi.waitFor(() => { expect(h.guard).toHaveBeenCalledTimes(2); expect(mocks.config).toHaveBeenCalledTimes(2); });
    expect(h.fetcher).not.toHaveBeenCalled();
    release();
    expect(await run).toMatchObject({ consumed: 1, results: [{ status: 'VERIFIED' }] });
  });
  it('stops an authentication-wide403 without marking the first loan inaccessible', async () => {
    const h = fixture(); h.runtime.encryptedAccessToken = null;
    h.fetcher.mockImplementation(async () => Response.json({}, { status: 403 }));
    expect(await runAriveActivePipelineDiagnosticChunk(h.input)).toMatchObject({ consumed: 0, results: [], invalidated: true, getRequests: 0, authenticationRequests: 1,
      deferred: { code: 'AUTH_HTTP_ERROR', phase: 'AUTH', httpStatus: 403 } });
  });
  it('defers provider throttling through the real shared cooldown instead of accepting a loan failure', async () => {
    const h = fixture(); h.fetcher.mockImplementation(async () => Response.json({}, { status: 429, headers: { 'retry-after': '60' } }));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 0, results: [], invalidated: false, deferred: { code: 'COOLDOWN' }, getRequests: 1 });
    expect(h.runtime.cooldownUntil!.getTime()).toBeGreaterThan(h.now.getTime()); expect(h.requests[0].finishedAt).not.toBeNull();
  });
  it('cannot bypass the existing request budget or disabled deployment', async () => {
    const h = fixture(); h.runtime.providerRequestLimit = 2;
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 0, getRequests: 1, deferred: { code: 'BUDGET_EXHAUSTED' } });
    mocks.enabled.mockReturnValue(false);
    expect(await runAriveActivePipelineDiagnosticChunk(h.input)).toMatchObject({ invalidated: true, getRequests: 0, deferred: { code: 'DISABLED' } });
  });
  it('honors lower remaining run limits and retains earlier completed loans for checkpointing', async () => {
    const h = fixture(); const second = { ...loan, id: 'loan-2', pipelineId: 'pipeline-2', loanNumber: '99999124', savedGuid: 'private-guid-2' };
    h.fetcher.mockImplementation(async url => { const other = String(url).includes('99999124') || String(url).endsWith('private-guid-2'); const source = other ? { ...details, ariveLoanId: 99999124, sysGUID: 'private-guid-2' } : details; return Response.json(String(url).includes('?') ? { count: 1, rows: [source] } : source); });
    const result = await runAriveActivePipelineDiagnosticChunk({ ...h.input, loans: [loan, second], maxGetRequests: 3 });
    expect(result).toMatchObject({ consumed: 1, getRequests: 3, invalidated: false, deferred: { code: 'DIAGNOSTIC_LIMIT' }, results: [{ pipelineId: 'pipeline-1', status: 'VERIFIED' }] });
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it.each(['HTTP503', 'NETWORK'])('defers %s without inventing an inaccessible loan', async failure => {
    const h = fixture(); h.fetcher.mockImplementation(async () => { if (failure === 'NETWORK') throw new Error('never-return-network-secret'); return Response.json({}, { status: 503 }); });
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 0, results: [], invalidated: false, deferred: { code: failure === 'HTTP503' ? 'HTTP_ERROR' : 'UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('never-return');
  });
  it('does not start a loan too near the deadline or accept an oversized chunk', async () => {
    const h = fixture();
    expect(await runAriveActivePipelineDiagnosticChunk({ ...h.input, deadlineMs: Date.now() + 10_000 })).toMatchObject({ consumed: 0, getRequests: 0, deferred: { code: 'DIAGNOSTIC_DEADLINE' } });
    expect(await runAriveActivePipelineDiagnosticChunk({ ...h.input, loans: Array(6).fill(loan) })).toMatchObject({ invalidated: true, getRequests: 0 });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it('does not expose caller access errors or report them as hundreds of loan failures', async () => {
    const h = fixture(); h.guard.mockRejectedValue(new Error('never-return-actor-token'));
    const result = await runAriveActivePipelineDiagnosticChunk(h.input);
    expect(result).toMatchObject({ consumed: 0, invalidated: true, deferred: { code: 'DIAGNOSTIC_UNAVAILABLE' } });
    expect(JSON.stringify(result)).not.toContain('never-return'); expect(h.fetcher).not.toHaveBeenCalled();
  });
});
