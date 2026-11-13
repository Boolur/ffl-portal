import 'server-only';
import { prisma } from './prisma';
import { decryptAriveCredentials, encryptAriveCredentials } from './ariveCrypto';
import { createPrismaAriveTransportStore } from './ariveTransportPrisma';
import { AriveTransportError, createAriveTransportSession, type TransportCredentials } from './ariveTransport';
import { jsonRecord } from './ariveSyncState';
import { verifyAriveRolloutIdentity, type AriveRolloutLoanIdentity } from './ariveRollout';
import { ARIVE_SYNC_PILOT } from './ariveSyncTypes';

type Phase = 'SHARED' | 'FRESH';
type Metadata = { httpStatus: number | null; requestId: string | null; gatewayCode: string | null; responseOperation: 'AUTH' | 'GET' | null };
export type AriveLoanAccessStep = Metadata & {
  phase: Phase; method: 'GET' | 'POST'; label: string; pathLabel: string;
  outcome: 'READ' | 'ERROR' | 'NOT_RUN' | 'INVALID_RESPONSE' | 'AUTHENTICATED';
  count: number | null; returnedRows: number | null; exactLoanIdMatches: number | null;
  identityMatches: boolean | null; pageComplete: boolean | null; message: string | null;
};
type DiagnosticSession = { metadata: Metadata; get(path: string): Promise<{ data: unknown; metadata: Metadata }> };
type OpenSession = (phase: Phase) => Promise<DiagnosticSession>;
const emptyMetadata: Metadata = { httpStatus: null, requestId: null, gatewayCode: null, responseOperation: null };
const gatewayCodes = new Set(['ForbiddenException', 'MissingAuthenticationTokenException', 'InvalidSignatureException', 'AccessDeniedException', 'UnauthorizedException', 'NotAuthorizedException', 'WAFForbiddenException']);
class DiagnosticError extends Error {
  constructor(public metadata: Metadata, public code: string) { super(code); }
}
function responseMetadata(response: Response, responseOperation: Metadata['responseOperation']): Metadata {
  const requestId = response.headers.get('x-amzn-requestid');
  const type = response.headers.get('x-amzn-errortype')?.split(':')[0];
  return { httpStatus: response.status, requestId: requestId && /^[a-zA-Z0-9-]{8,100}$/.test(requestId) ? requestId : null, gatewayCode: type && gatewayCodes.has(type) ? type : null, responseOperation };
}
function safeError(error: unknown) {
  const metadata = error instanceof DiagnosticError ? error.metadata : emptyMetadata;
  const code = error instanceof DiagnosticError || error instanceof AriveTransportError ? error.code : 'UNAVAILABLE';
  const stop = ['DIAGNOSTIC_LIMIT', 'DIAGNOSTIC_DEADLINE', 'COOLDOWN', 'BUSY', 'BUDGET_EXHAUSTED', 'DISABLED', 'CREDENTIALS_CHANGED', 'QUOTA_UNCONFIRMED', 'OPERATOR_BUDGET_UNAUTHORIZED'].includes(code);
  const message = code === 'INVALID_RESPONSE' ? 'Arive returned an invalid response.' : code === 'INVALID_TOKEN' ? 'Arive did not issue a valid authentication token.'
    : metadata.httpStatus ? `Arive ${metadata.responseOperation === 'AUTH' ? 'authentication' : 'loan read'} returned HTTP ${metadata.httpStatus}.` : code === 'DIAGNOSTIC_LIMIT' ? 'The diagnostic request limit was reached.'
    : code === 'DIAGNOSTIC_DEADLINE' ? 'The diagnostic time limit was reached.' : code === 'CREDENTIALS_CHANGED' ? 'The saved credentials changed; this comparison stopped.' : stop ? 'Shared request controls deferred this check.'
      : 'This check could not complete.';
  const transientHttp = metadata.httpStatus !== null && (metadata.httpStatus >= 500 || metadata.httpStatus === 408 || metadata.httpStatus === 429);
  return { metadata, stop, message, incomplete: code !== 'HTTP_ERROR' || metadata.responseOperation === 'AUTH' || transientHttp };
}

/** Counts actual HTTP sends, including the transport's ordinary token refresh and retry. */
export function createAriveDiagnosticFetch(fetcher: typeof fetch, deadline: number, now: () => number = Date.now) {
  let getRequests = 0; let authenticationRequests = 0;
  const send: typeof fetch = async (input, init) => {
    if (now() >= deadline - 25_000) throw new AriveTransportError('DIAGNOSTIC_DEADLINE', 'Diagnostic deadline reached.');
    const url = String(input); const method = init?.method ?? 'GET';
    const auth = method === 'POST' && url === 'https://gwapiconnect.myarive.com/api/auth/access-token';
    if (!auth && (method !== 'GET' || !/^https:\/\/gwapiconnect\.myarive\.com\/api\/loans(?:[/?]|$)/.test(url))) throw new AriveTransportError('READ_ONLY', 'Only diagnostic loan reads are allowed.');
    if (auth ? authenticationRequests >= 2 : getRequests >= 8) throw new AriveTransportError('DIAGNOSTIC_LIMIT', 'Diagnostic request limit reached.');
    if (auth) authenticationRequests++; else getRequests++;
    return fetcher(input, init);
  };
  return { fetch: send, counts: () => ({ getRequests, authenticationRequests }) };
}

/** Pure orchestration: discard provider bodies after deriving booleans/counts. */
export async function runAriveLoanAccessComparison(loan: AriveRolloutLoanIdentity, open: OpenSession) {
  const steps: AriveLoanAccessStep[] = []; let stopped = false; let incomplete = false;
  const guidCandidates = new Set<string>();
  const exactPath = `/loans?searchField=DISPLAY_ID&searchValue=${encodeURIComponent(loan.loanNumber)}&limit=100&offset=0`;
  const borrowerPath = `/loans?searchField=BORROWER_NAME&searchValue=${encodeURIComponent(loan.borrowerName.trim())}&limit=100&offset=0`;
  const make = (phase: Phase, label: string, pathLabel: string, method: 'GET' | 'POST' = 'GET'): AriveLoanAccessStep => ({ ...emptyMetadata, phase, method, label, pathLabel, outcome: 'NOT_RUN', count: null, returnedRows: null, exactLoanIdMatches: null, identityMatches: null, pageComplete: null, message: null });
  const identity = (value: unknown) => { try { verifyAriveRolloutIdentity(value, loan); return true; } catch { return false; } };
  const read = async (session: DiagnosticSession | null, phase: Phase, label: string, path: string, pathLabel: string, search: boolean, control = false) => {
    const step = make(phase, label, pathLabel); steps.push(step);
    if (!session || stopped) { step.message = 'Not run because this session or the shared request budget was unavailable.'; return; }
    try {
      const result = await session.get(path); Object.assign(step, result.metadata); const value = jsonRecord(result.data);
      if (search) {
        if (typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 0 || !Array.isArray(value.rows) || value.rows.length > 100 || value.count < value.rows.length) { step.outcome = 'INVALID_RESPONSE'; step.message = 'Arive returned an invalid search page.'; return; }
        const matches = value.rows.map(jsonRecord).filter(row => String(row.ariveLoanId) === loan.loanNumber);
        step.count = value.count; step.returnedRows = value.rows.length; step.pageComplete = value.count === value.rows.length;
        step.exactLoanIdMatches = matches.length; step.identityMatches = matches.length === 1 ? identity(matches[0]) : matches.length > 1 ? false : null;
        if (phase === 'SHARED' && matches.length === 1 && typeof matches[0].sysGUID === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(matches[0].sysGUID)) guidCandidates.add(matches[0].sysGUID);
      } else {
        const expected = control ? ARIVE_SYNC_PILOT.loanNumber : loan.loanNumber;
        step.exactLoanIdMatches = String(value.ariveLoanId) === expected ? 1 : 0;
        step.identityMatches = control ? null : identity(value);
      }
      step.outcome = 'READ';
    } catch (error) { const safe = safeError(error); Object.assign(step, safe.metadata); step.outcome = 'ERROR'; step.message = safe.message; stopped ||= safe.stop; incomplete ||= safe.incomplete; }
  };
  const session = async (phase: Phase) => {
    if (stopped) return null;
    try {
      const result = await open(phase);
      if (phase === 'FRESH') steps.push({ ...make(phase, 'Fresh authentication using the same saved credentials', '/auth/access-token', 'POST'), ...result.metadata, outcome: 'AUTHENTICATED' });
      return result;
    } catch (error) {
      const safe = safeError(error); stopped ||= safe.stop; incomplete = true;
      steps.push({ ...make(phase, phase === 'FRESH' ? 'Fresh authentication' : 'Shared session initialization', '/auth/access-token', 'POST'), ...safe.metadata, outcome: 'ERROR', message: safe.message });
      return null;
    }
  };
  const shared = await session('SHARED');
  await read(shared, 'SHARED', 'Synthetic control by numeric loan number', `/loans/${ARIVE_SYNC_PILOT.loanNumber}`, '/loans/{control numeric ID}', false, true);
  await read(shared, 'SHARED', 'Target by numeric loan number', `/loans/${loan.loanNumber}`, '/loans/{target numeric ID}', false);
  await read(shared, 'SHARED', 'Exact DISPLAY_ID target search', exactPath, '/loans?searchField=DISPLAY_ID&searchValue={target}', true);
  await read(shared, 'SHARED', 'Documented borrower-name search', borrowerPath, '/loans?searchField=BORROWER_NAME&searchValue={portal borrower}', true);
  if (guidCandidates.size === 1) await read(shared, 'SHARED', 'Target by GUID found in an exact numeric match', `/loans/${encodeURIComponent([...guidCandidates][0])}`, '/loans/{exact-match GUID}', false);
  else steps.push({ ...make('SHARED', 'Target by GUID', '/loans/{exact-match GUID}'), message: guidCandidates.size ? 'Searches returned inconsistent GUIDs; no GUID read was attempted.' : 'No unique exact target row supplied a valid GUID.' });
  const fresh = await session('FRESH');
  await read(fresh, 'FRESH', 'Target by numeric loan number after fresh authentication', `/loans/${loan.loanNumber}`, '/loans/{target numeric ID}', false);
  await read(fresh, 'FRESH', 'Exact DISPLAY_ID search after fresh authentication', exactPath, '/loans?searchField=DISPLAY_ID&searchValue={target}', true);
  return { steps, partial: stopped || incomplete || steps.some(step => step.outcome === 'INVALID_RESPONSE'), checkedAt: new Date().toISOString(),
    limitations: 'The shared phase may use the normal token refresh/retry behavior. Fresh authentication uses the same saved credentials without replacing the shared cached token. Numeric detail paths may be unsupported; compare the synthetic control. Search counts describe only the returned page when pageComplete is false. No enrollment or identity checks are bypassed.' };
}

/** Server-only adapter. Credentials remain inside this invocation and the existing transport. */
export async function compareSavedAriveLoanAccess(loan: AriveRolloutLoanIdentity) {
  const secret = process.env.NEXTAUTH_SECRET ?? '';
  const config = await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { encryptedCredentials: true } });
  if (!config) throw new AriveTransportError('NO_CREDENTIALS', 'Connect the saved Arive credentials first.');
  let credentials: TransportCredentials;
  try { credentials = JSON.parse(decryptAriveCredentials(config.encryptedCredentials, secret)); } catch { throw new AriveTransportError('NO_CREDENTIALS', 'The saved Arive credentials could not be read.'); }
  if (!credentials || [credentials.clientId, credentials.secret, credentials.apiKey].some(value => typeof value !== 'string' || !value)) throw new AriveTransportError('NO_CREDENTIALS', 'The saved Arive credentials are incomplete.');
  const confidential = new Set([credentials.clientId, credentials.secret, credentials.apiKey]);
  const safeMetadata = (value: Metadata): Metadata => ({ ...value, requestId: value.requestId && [...confidential].some(secretValue => secretValue && value.requestId!.includes(secretValue)) ? null : value.requestId });
  const currentCredentials = async () => {
    const current = await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { encryptedCredentials: true } });
    if (!current || current.encryptedCredentials !== config.encryptedCredentials) throw new AriveTransportError('CREDENTIALS_CHANGED', 'The saved Arive connection changed during this diagnostic.');
    return { ...credentials };
  };
  const bounded = createAriveDiagnosticFetch(fetch, Date.now() + 150_000);
  const result = await runAriveLoanAccessComparison(loan, async phase => {
    let metadata: Metadata = { ...emptyMetadata };
    const observed: typeof fetch = async (input, init) => { const response = await bounded.fetch(input, init); metadata = responseMetadata(response, init?.method === 'POST' ? 'AUTH' : 'GET'); return response; };
    const wrap = (error: unknown) => new DiagnosticError(safeMetadata(error instanceof DiagnosticError ? error.metadata : error instanceof AriveTransportError && !(error.code === 'COOLDOWN' && metadata.httpStatus === 429) ? emptyMetadata : metadata), error instanceof DiagnosticError || error instanceof AriveTransportError ? error.code : 'UNAVAILABLE');
    let api: Awaited<ReturnType<typeof createAriveTransportSession>>;
    try {
      api = await createAriveTransportSession({ store: createPrismaAriveTransportStore(), credentials: currentCredentials, encryptionSecret: secret,
        encrypt: value => { confidential.add(value); return encryptAriveCredentials(value, secret); }, decrypt: value => { const token = decryptAriveCredentials(value, secret); confidential.add(token); return token; }, fetch: observed,
        readOnly: true, freshAuthentication: phase === 'FRESH', parseJson: async (response, operation) => {
          if (!response.ok) throw new DiagnosticError(responseMetadata(response, operation === 'authentication' ? 'AUTH' : 'GET'), 'HTTP_ERROR');
          try { const value: unknown = await response.json(); const token = operation === 'authentication' ? jsonRecord(value).AccessToken : null; if (typeof token === 'string') confidential.add(token); return value; } catch { throw new DiagnosticError(responseMetadata(response, operation === 'authentication' ? 'AUTH' : 'GET'), 'INVALID_RESPONSE'); }
        } });
    } catch (error) { throw wrap(error); }
    return { metadata: safeMetadata(metadata), get: async path => { metadata = { ...emptyMetadata }; try { const data: unknown = await api(path); return { data, metadata: safeMetadata(metadata) }; } catch (error) { throw wrap(error); } } };
  });
  return { ...result, ...bounded.counts() };
}
