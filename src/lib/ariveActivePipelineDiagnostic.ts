import 'server-only';
import { prisma } from './prisma';
import { decryptAriveCredentials, encryptAriveCredentials } from './ariveCrypto';
import { createPrismaAriveTransportStore, sharedAriveTransportEnabled } from './ariveTransportPrisma';
import { AriveTransportError, createAriveTransportSession, type TransportCredentials } from './ariveTransport';
import { verifyAriveRolloutIdentity, type AriveRolloutLoanIdentity } from './ariveRollout';
import { jsonRecord } from './ariveSyncState';

export type AriveActiveDiagnosticLoan = AriveRolloutLoanIdentity & {
  pipelineId: string; version: number; savedGuid?: string | null; savedOriginatorEmail?: string | null;
  duplicateNumericId?: boolean; practice?: boolean; synthetic?: boolean;
};
export type AriveActiveDiagnosticStatus = 'VERIFIED' | 'INVALID_LOAN_NUMBER' | 'DUPLICATE_PORTAL_NUMBER'
  | 'PRACTICE_EXCLUDED' | 'SOURCE_CHANGED' | 'NO_API_MATCH' | 'AMBIGUOUS_API_MATCH' | 'INVALID_RESPONSE' | 'IDENTITY_MISMATCH' | 'HTTP_ERROR';
export type AriveActiveDiagnosticPhase = 'INPUT' | 'SEARCH' | 'DETAIL' | 'AUTH';
export type AriveActiveDiagnosticResult = {
  pipelineId: string; loanNumber: string; version: number; synthetic: boolean; checkedAt: string;
  status: AriveActiveDiagnosticStatus; phase: AriveActiveDiagnosticPhase;
  apiVisible: boolean | null; searchIdentity: boolean | null; detailIdentity: boolean | null;
  identityIssue: 'LOAN_NUMBER_OR_GUID' | 'ORIGINATOR' | 'BORROWER_NAME' | 'UNVERIFIED' | null;
  httpStatus: number | null; gatewayCode: string | null;
};
export type AriveActiveDiagnosticDeferred = {
  code: string; retryAt: string | null; phase: AriveActiveDiagnosticPhase; httpStatus: number | null; gatewayCode: string | null;
};
export type AriveActiveDiagnosticChunkResult = {
  results: AriveActiveDiagnosticResult[]; consumed: number; getRequests: number; authenticationRequests: number;
  deferred: AriveActiveDiagnosticDeferred | null; invalidated: boolean;
};
export type AriveActiveDiagnosticGuardCode = 'SOURCE_CHANGED' | 'CONTROL_CHANGED' | 'CREDENTIALS_CHANGED' | 'ACCESS_CHANGED' | 'LEASE_LOST' | 'EXPIRED';
export class AriveActiveDiagnosticGuardError extends Error {
  constructor(public code: AriveActiveDiagnosticGuardCode) { super(code); this.name = 'AriveActiveDiagnosticGuardError'; }
}
export type AriveActiveDiagnosticChunkInput = {
  loans: AriveActiveDiagnosticLoan[];
  /** ISO updatedAt from the saved connection, captured when the run was created. */
  credentialRevision: string;
  /** Fresh account, paused controls/generation, run lease, and source checks. Never runs inside a network-holding transaction. */
  guard: () => Promise<void>;
  deadlineMs?: number;
  /** Remaining run-wide ceilings supplied by persistence; these can only lower chunk limits. */
  maxGetRequests?: number; maxAuthenticationRequests?: number;
};
type Metadata = { httpStatus: number | null; gatewayCode: string | null; phase: AriveActiveDiagnosticPhase };
const gatewayCodes = new Set(['ForbiddenException', 'MissingAuthenticationTokenException', 'InvalidSignatureException', 'AccessDeniedException', 'UnauthorizedException', 'NotAuthorizedException', 'WAFForbiddenException']);
const transientCodes = new Set(['BUSY', 'BUDGET_EXHAUSTED', 'COOLDOWN', 'TOKEN_REFRESH_BUSY', 'DIAGNOSTIC_DEADLINE', 'DIAGNOSTIC_LIMIT']);
const emptyMetadata = (phase: AriveActiveDiagnosticPhase): Metadata => ({ httpStatus: null, gatewayCode: null, phase });
class ProviderReadError extends Error {
  constructor(public code: 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'UNAVAILABLE', public metadata: Metadata) { super(code); }
}
function safeFailure(error: unknown, phase: AriveActiveDiagnosticPhase, now: number): { deferred: AriveActiveDiagnosticDeferred; invalidated: boolean } {
  if (error instanceof AriveActiveDiagnosticGuardError) return { deferred: { ...emptyMetadata(phase), code: error.code, retryAt: null }, invalidated: true };
  if (error instanceof AriveTransportError) {
    const retryable = transientCodes.has(error.code);
    return { deferred: { ...emptyMetadata(phase), code: error.code, retryAt: retryable ? (error.retryAt ?? new Date(now + 5000)).toISOString() : null }, invalidated: !retryable };
  }
  if (error instanceof ProviderReadError) {
    // Authentication failures are connection-wide. Do not turn one bad token
    // or provider outage into hundreds of individual loan-access failures.
    const fatal = error.metadata.phase === 'AUTH' || error.code === 'HTTP_ERROR' && error.metadata.httpStatus === 401;
    return { deferred: { ...error.metadata, code: error.metadata.phase === 'AUTH' ? `AUTH_${error.code}` : error.code,
      retryAt: fatal ? null : new Date(now + 30_000).toISOString() }, invalidated: fatal };
  }
  // A guard can throw a caller-owned access error. Unknown errors fail closed;
  // never return their text, stack, or provider response body.
  return { deferred: { ...emptyMetadata(phase), code: 'DIAGNOSTIC_UNAVAILABLE', retryAt: null }, invalidated: true };
}
function identityCheck(source: unknown, loan: AriveActiveDiagnosticLoan, guid?: string) {
  try {
    verifyAriveRolloutIdentity(source, loan, { ariveGuid: loan.savedGuid || guid || null, verifiedOriginatorEmail: loan.savedOriginatorEmail });
    return { pass: true, issue: null } as const;
  } catch (error) {
    const text = error instanceof Error ? error.message : '';
    const issue = text.includes('loan number or permanent identity') ? 'LOAN_NUMBER_OR_GUID'
      : text.includes('originator') ? 'ORIGINATOR' : text.includes('borrower') ? 'BORROWER_NAME' : 'UNVERIFIED';
    return { pass: false, issue } as const;
  }
}

/** A diagnostic chunk only reads the provider. Its sole database mutations are
 * the existing transport's reservations, token cache, and provider cooldown.
 * The caller owns durable diagnostic progress and freshly authorizes each run. */
export async function runAriveActivePipelineDiagnosticChunk(input: AriveActiveDiagnosticChunkInput): Promise<AriveActiveDiagnosticChunkResult> {
  const result: AriveActiveDiagnosticChunkResult = { results: [], consumed: 0, getRequests: 0, authenticationRequests: 0, deferred: null, invalidated: false };
  let phase: AriveActiveDiagnosticPhase = 'INPUT';
  let finalCheck: (() => Promise<void>) | null = null;
  const deadline = Math.min(input.deadlineMs ?? Infinity, Date.now() + 120_000);
  const getLimit = Math.min(input.maxGetRequests ?? 16, 16); const authLimit = Math.min(input.maxAuthenticationRequests ?? 2, 2);
  try {
    if (!Array.isArray(input.loans) || input.loans.length > 5 || !input.credentialRevision || !Number.isFinite(Date.parse(input.credentialRevision))
      || !Number.isSafeInteger(getLimit) || getLimit < 0 || !Number.isSafeInteger(authLimit) || authLimit < 0 || !Number.isFinite(deadline)) {
      throw new AriveActiveDiagnosticGuardError('EXPIRED');
    }
    if (!sharedAriveTransportEnabled()) throw new AriveTransportError('DISABLED', 'Shared requests are disabled.');
    await input.guard();
    const secret = process.env.NEXTAUTH_SECRET ?? '';
    const config = await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { encryptedCredentials: true, updatedAt: true } });
    if (!config || config.updatedAt.toISOString() !== input.credentialRevision) throw new AriveActiveDiagnosticGuardError('CREDENTIALS_CHANGED');
    let credentials: TransportCredentials;
    try { credentials = JSON.parse(decryptAriveCredentials(config.encryptedCredentials, secret)); }
    catch { throw new AriveTransportError('NO_CREDENTIALS', 'Saved credentials could not be read.'); }
    if (!credentials || [credentials.clientId, credentials.secret, credentials.apiKey].some(value => typeof value !== 'string' || !value)) throw new AriveTransportError('NO_CREDENTIALS', 'Saved credentials are incomplete.');
    const checkConnection = async () => {
      const current = await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { encryptedCredentials: true, updatedAt: true } });
      if (!current || current.updatedAt.toISOString() !== input.credentialRevision || current.encryptedCredentials !== config.encryptedCredentials) throw new AriveActiveDiagnosticGuardError('CREDENTIALS_CHANGED');
    };
    const check = async () => { await input.guard(); await checkConnection(); };
    finalCheck = check;
    let permittedGet: string | null = null;
    let metadata = emptyMetadata(phase);
    const boundedFetch: typeof fetch = async (request, init) => {
      await check();
      if (Date.now() >= deadline - 25_000) throw new AriveTransportError('DIAGNOSTIC_DEADLINE', 'Diagnostic chunk deadline reached.');
      const url = String(request); const method = init?.method ?? 'GET';
      const auth = method === 'POST' && url === 'https://gwapiconnect.myarive.com/api/auth/access-token';
      if (!auth && (method !== 'GET' || !permittedGet || url !== `https://gwapiconnect.myarive.com/api${permittedGet}` || init?.body !== undefined)) throw new AriveTransportError('READ_ONLY', 'Only the current exact-loan diagnostic read is allowed.');
      if (auth ? result.authenticationRequests >= authLimit : result.getRequests >= getLimit) throw new AriveTransportError('DIAGNOSTIC_LIMIT', 'Diagnostic chunk request limit reached.');
      if (auth) result.authenticationRequests++; else result.getRequests++;
      metadata = emptyMetadata(auth ? 'AUTH' : phase);
      let response: Response;
      try { response = await fetch(request, init); }
      catch { throw new ProviderReadError('UNAVAILABLE', metadata); }
      const gateway = response.headers.get('x-amzn-errortype')?.split(':')[0];
      metadata = { httpStatus: response.status, gatewayCode: gateway && gatewayCodes.has(gateway) ? gateway : null, phase: auth ? 'AUTH' : phase };
      return response;
    };
    let session: Awaited<ReturnType<typeof createAriveTransportSession>> | null = null;
    const read = async (path: string) => {
      metadata = emptyMetadata(phase); permittedGet = path;
      // Token bookkeeping can read credentials several times. Its callback
      // checks rotation; the full account/run/control guard belongs directly
      // before each actual send and after each accepted read, including retries.
      session ??= await createAriveTransportSession({ store: createPrismaAriveTransportStore(), credentials: async () => { await checkConnection(); return { ...credentials }; },
        encryptionSecret: secret, encrypt: token => encryptAriveCredentials(token, secret), decrypt: token => decryptAriveCredentials(token, secret),
        readOnly: true, fetch: boundedFetch, parseJson: async response => {
          if (!response.ok) throw new ProviderReadError('HTTP_ERROR', metadata);
          try { return await response.json(); } catch { throw new ProviderReadError('INVALID_RESPONSE', metadata); }
        } });
      let value: unknown;
      try { value = await session(path); }
      catch (error) { await check(); throw error; }
      await check(); return { value, metadata: { ...metadata } };
    };
    const seenNumbers = new Set<string>();
    for (const loan of input.loans) {
      await check(); phase = 'INPUT';
      const outcome: AriveActiveDiagnosticResult = { pipelineId: loan.pipelineId, loanNumber: loan.loanNumber, version: loan.version, synthetic: loan.synthetic === true,
        checkedAt: new Date().toISOString(), status: 'INVALID_RESPONSE', phase, apiVisible: null, searchIdentity: null, detailIdentity: null,
        identityIssue: null, httpStatus: null, gatewayCode: null };
      const finish = () => { outcome.checkedAt = new Date().toISOString(); result.results.push(outcome); result.consumed++; };
      if (loan.practice) { outcome.status = 'PRACTICE_EXCLUDED'; finish(); continue; }
      if (!/^\d{1,15}$/.test(loan.loanNumber)) { outcome.status = 'INVALID_LOAN_NUMBER'; finish(); continue; }
      if (loan.duplicateNumericId || seenNumbers.has(loan.loanNumber) || input.loans.filter(item => item.loanNumber === loan.loanNumber).length > 1) { outcome.status = 'DUPLICATE_PORTAL_NUMBER'; finish(); continue; }
      seenNumbers.add(loan.loanNumber);
      if (Date.now() >= deadline - 60_000) throw new AriveTransportError('DIAGNOSTIC_DEADLINE', 'Not enough time remains to start another loan.');
      try {
        phase = 'SEARCH'; outcome.phase = phase;
        const search = await read(`/loans?searchField=DISPLAY_ID&searchValue=${encodeURIComponent(loan.loanNumber)}&limit=100&offset=0`);
        Object.assign(outcome, search.metadata);
        const data = jsonRecord(search.value);
        if (!Number.isSafeInteger(data.count) || Number(data.count) < 0 || !Array.isArray(data.rows) || data.rows.length >= 100 || data.count !== data.rows.length) { finish(); continue; }
        const matches = data.rows.map(jsonRecord).filter(row => String(row.ariveLoanId) === loan.loanNumber);
        if (matches.length !== 1) {
          outcome.status = matches.length ? 'AMBIGUOUS_API_MATCH' : 'NO_API_MATCH';
          // This describes visibility through these credentials, not deletion or
          // absence in Arive itself. Never accept a neighboring search result.
          outcome.apiVisible = matches.length ? true : false; finish(); continue;
        }
        outcome.apiVisible = true;
        const source = matches[0]; const guid = source.sysGUID;
        if (typeof guid !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(guid)) { finish(); continue; }
        const searchedIdentity = identityCheck(source, loan);
        outcome.searchIdentity = searchedIdentity.pass;
        // Saved permanent identity is a hard boundary before following a GUID.
        if (loan.savedGuid && loan.savedGuid !== guid) { outcome.status = 'IDENTITY_MISMATCH'; outcome.identityIssue = 'LOAN_NUMBER_OR_GUID'; finish(); continue; }
        phase = 'DETAIL'; outcome.phase = phase;
        const detail = await read(`/loans/${encodeURIComponent(guid)}`); Object.assign(outcome, detail.metadata);
        const detailIdentity = identityCheck(detail.value, loan, guid); outcome.detailIdentity = detailIdentity.pass;
        outcome.status = searchedIdentity.pass && detailIdentity.pass ? 'VERIFIED' : 'IDENTITY_MISMATCH';
        outcome.identityIssue = detailIdentity.issue ?? searchedIdentity.issue;
        finish();
      } catch (error) {
        if (error instanceof ProviderReadError && error.code === 'HTTP_ERROR' && error.metadata.phase !== 'AUTH'
          && error.metadata.httpStatus !== null && [400, 403, 404, 422].includes(error.metadata.httpStatus)) {
          outcome.status = 'HTTP_ERROR'; Object.assign(outcome, error.metadata); finish();
        } else throw error;
      }
    }
  } catch (error) {
    const failed = safeFailure(error, phase, Date.now()); result.deferred = failed.deferred; result.invalidated = failed.invalidated;
    if (result.invalidated) { result.results = []; result.consumed = 0; }
  }
  if (finalCheck) {
    try { await finalCheck(); }
    catch (error) {
      const failed = safeFailure(error, phase, Date.now()); result.deferred = failed.deferred; result.invalidated = true;
      result.results = []; result.consumed = 0;
    }
  }
  return result;
}
