import 'server-only';
import { prisma } from '@/lib/prisma';
import { decryptAriveCredentials } from '@/lib/ariveCrypto';
import { sharedAriveSessionIfEnabled } from './ariveTransportPrisma';
import { AriveTransportError } from './ariveTransport';

const BASE = 'https://gwapiconnect.myarive.com/api';
export type AriveCredentials = { clientId: string; secret: string; apiKey: string };
export type AriveNote = { id: string; text: string; author: string; createdAt: string; updatedAt: string; replies: AriveNote[] };
export class AriveError extends Error {}
export async function ariveConfigured() {
  return !!(await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { id: true } }));
}
async function credentials(): Promise<AriveCredentials> {
  const row = await prisma.ariveIntegrationConfig.findUnique({ where: { id: 'company' } });
  if (!row) throw new AriveError('A portal Admin III must connect your branch’s Arive API credentials first.');
  try { return JSON.parse(decryptAriveCredentials(row.encryptedCredentials, process.env.NEXTAUTH_SECRET || '')); }
  catch { throw new AriveError('Arive credentials could not be decrypted. Ask an Admin III to reconnect.'); }
}
async function stageValidationDiagnostic(response: Response, secrets: readonly string[]): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
    const record = body as Record<string, unknown>;
    const error = record.error && typeof record.error === 'object' && !Array.isArray(record.error) ? record.error as Record<string, unknown> : null;
    const message = typeof record.message === 'string' ? record.message : typeof error?.message === 'string' ? error.message : '';
    const code = typeof record.code === 'string' ? record.code : '';
    if (!message && !code) return '';
    let value = [code ? `Code: ${code}.` : '', message].filter(Boolean).join(' ');
    // Only these scalar validation fields are useful. Never expose raw bodies,
    // nested request data, or credentials reflected by an upstream validator.
    for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
      for (const representation of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
        value = value.split(representation).join('[redacted]');
      }
    }
    value = value
      .replace(/https?:\/\/[^\s<>"']+/gi, '[redacted URL]')
      .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [redacted]')
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
      .replace(/\b(?:client[ _-]?id|api[ _-]?key|secret|password|access[ _-]?token|authorization)\s*["']?\s*[:=]\s*["']?[^\s,;"'}]+/gi, '[redacted credential]')
      .replace(/[A-Za-z0-9_+\/=\-]{32,}/g, '[redacted]')
      .replace(/\r?\n\s*at\s[\s\S]*/g, '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, 500);
    return value ? `Validation: ${value}` : '';
  } catch { return ''; }
}
async function responseJson(response: Response, operation = 'API request', validationSecrets?: readonly string[]) {
  if (!response.ok) {
    // Return only allowlisted gateway diagnostics, never arbitrary upstream bodies or credentials.
    const knownTypes = new Set(['ForbiddenException', 'MissingAuthenticationTokenException', 'InvalidSignatureException', 'AccessDeniedException', 'UnauthorizedException', 'NotAuthorizedException', 'WAFForbiddenException']);
    const type = response.headers.get('x-amzn-errortype')?.split(':')[0];
    const requestId = response.headers.get('x-amzn-requestid');
    const diagnostics = [type && knownTypes.has(type) ? `Gateway code: ${type}.` : '', requestId && /^[a-zA-Z0-9-]{8,100}$/.test(requestId) ? `Request ID: ${requestId}.` : ''].filter(Boolean).join(' ');
    const validation = response.status === 400 && validationSecrets ? await stageValidationDiagnostic(response, validationSecrets) : '';
    throw new AriveError(`Arive ${operation} returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check the credentials and Arive-provisioned permission for this operation.' : response.status === 429 ? 'Rate limit reached; try again later.' : 'Please retry or contact your administrator.'}${diagnostics ? ` ${diagnostics}` : ''}${validation ? ` ${validation}` : ''}`);
  }
  try { return await response.json(); } catch { throw new AriveError('Arive returned an unexpected response.'); }
}
function safeSharedSession(shared: NonNullable<Awaited<ReturnType<typeof sharedAriveSessionIfEnabled>>>) {
  return async (path: string, body?: object, method?: 'PATCH') => {
    try { return await shared(path, body, method); }
    catch (error) {
      if (error instanceof AriveError || error instanceof AriveTransportError) throw error;
      throw new AriveError('Arive request did not finish. Check the transfer status before retrying.');
    }
  };
}
export async function ariveSession(provided?: AriveCredentials, observe?: (headers: Headers, operation: string) => void) {
  const parse = async (response: Response, operation = 'API request', validationSecrets?: readonly string[]) => {
    // Internal diagnostics see headers only; no token/body is exposed to callers.
    observe?.(response.headers, operation);
    return responseJson(response, operation, validationSecrets);
  };
  try {
    const shared = await sharedAriveSessionIfEnabled(parse, { provided });
    if (shared) return safeSharedSession(shared);
  } catch (error) {
    if (error instanceof AriveError || error instanceof AriveTransportError) throw error;
    throw new AriveError('Shared Arive request controls are unavailable. Please retry later.');
  }
  const c = provided || await credentials();
  let auth;
  try { auth = await parse(await fetch(`${BASE}/auth/access-token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey }, body: JSON.stringify(c), cache: 'no-store', signal: AbortSignal.timeout(20000), redirect: 'error' }), 'authentication'); }
  catch (e) { if (e instanceof AriveError) throw e; throw new AriveError('Unable to connect to Arive.'); }
  if (typeof auth.AccessToken !== 'string' || !auth.AccessToken) throw new AriveError('Arive did not issue an access token.');
  return async (path: string, body?: object, method?: 'PATCH') => {
    try { return await parse(await fetch(`${BASE}${path}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey, Authorization: `Bearer ${auth.AccessToken}` }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(25000), redirect: 'error' }), path === '/loans/document-classifications' ? 'document classification access check' : 'API request', method === 'PATCH' && /^\/loans\/[a-zA-Z0-9-]{1,100}(?:\?sync=true)?$/.test(path) ? [c.clientId, c.secret, c.apiKey, auth.AccessToken] : undefined); }
    catch (e) { if (e instanceof AriveError) throw e; throw new AriveError('Arive request did not finish. Check the transfer status before retrying.'); }
  };
}
/** Required shared limits and a GET-only surface for broader inbound workers. */
export async function ariveReadOnlySession() {
  try {
    const shared = await sharedAriveSessionIfEnabled(responseJson, { readOnly: true, required: true });
    if (!shared) throw new AriveTransportError('DISABLED', 'Shared Arive request controls are not enabled.');
    return safeSharedSession(shared);
  } catch (error) {
    if (error instanceof AriveError || error instanceof AriveTransportError) throw error;
    throw new AriveError('Shared Arive request controls are unavailable. Please retry later.');
  }
}
export async function ariveClassifications(provided?: AriveCredentials) {
  const api = await ariveSession(provided);
  const data = await api('/loans/document-classifications');
  if (!Array.isArray(data.classifications) || data.classifications.some((c: { name?: unknown }) => typeof c.name !== 'string')) throw new AriveError('Arive returned an unexpected classification list.');
  return data.classifications.map((c: { name: string; subName?: string }) => ({ name: c.name, subName: typeof c.subName === 'string' ? c.subName : '' })) as { name: string; subName: string }[];
}
export async function findAriveLoan(number: string) {
  if (!/^\d{1,15}$/.test(number)) throw new AriveError('Enter the numeric Arive loan number.');
  const api = await ariveSession();
  const data = await api(`/loans?searchField=DISPLAY_ID&searchValue=${encodeURIComponent(number)}&limit=100&offset=0`);
  if (!Array.isArray(data.rows)) throw new AriveError('Unexpected Arive loan search response.');
  const matches = data.rows.filter((r: { ariveLoanId?: unknown }) => String(r.ariveLoanId) === number);
  if (matches.length !== 1 || !matches[0].sysGUID) throw new AriveError('No unique Arive loan was found for that number.');
  return matches[0] as { ariveLoanId: number; sysGUID: string; loanOriginatorEmail?: string; baseLoanAmount?: number; loanBorrowers?: { firstName?: string; lastName?: string; applicantType?: string }[] };
}
function noteValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return ['object', 'string', 'number', 'boolean', 'undefined'].includes(typeof value) ? typeof value : 'other';
}
function noteDateType(value: unknown): string {
  if (typeof value !== 'string') return noteValueType(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? 'string/ISO-date-time' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'string/ISO-date' : 'string/other-format';
}
function noteSchemaError(value: unknown, depth: number): AriveError {
  const note = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = note.text;
  // Only conventional structural field names are safe to display. Unknown keys can themselves contain private text.
  const structuralKeys = new Set(['type', 'text', 'content', 'body', 'value', 'html', 'plainText', 'delta', 'ops', 'insert', 'attributes', 'blocks', 'children', 'paragraphs', 'runs', 'json', 'document', 'data', 'contentState']);
  const keys = text && typeof text === 'object' && !Array.isArray(text) ? Object.keys(text) : [];
  const safeKeys = keys.filter(key => structuralKeys.has(key)).sort().slice(0, 12);
  const hiddenKeyCount = keys.length - safeKeys.length;
  return new AriveError(`Arive returned an unexpected note format. Schema: depth=${depth}; note=${noteValueType(value)}; id=${noteValueType(note.id)}; text=${noteValueType(text)}; text keys=${safeKeys.length ? safeKeys.join(',') : 'none'}; other text keys=${hiddenKeyCount}; createdAt=${noteDateType(note.createdAt)}; updatedAt=${noteDateType(note.updatedAt)}; nestedNotes=${noteValueType(note.nestedNotes)}.`);
}
function normalizeNote(value: unknown, depth = 0): AriveNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw noteSchemaError(value, depth);
  const note = value as Record<string, unknown>;
  const id = typeof note.id === 'string' && note.id.trim()
    ? note.id.trim()
    : typeof note.id === 'number' && Number.isSafeInteger(note.id) && note.id > 0
      ? String(note.id)
      : null;
  if (!id || typeof note.text !== 'string') throw noteSchemaError(note, depth);
  return { id, text: note.text, author: typeof note.createdByName === 'string' ? note.createdByName : 'Arive user', createdAt: typeof note.createdAt === 'string' ? note.createdAt : '', updatedAt: typeof note.updatedAt === 'string' ? note.updatedAt : '', replies: depth < 3 && Array.isArray(note.nestedNotes) ? note.nestedNotes.map(n => normalizeNote(n, depth + 1)) : [] };
}
export async function readAriveNotes(id: string, session?: Awaited<ReturnType<typeof ariveSession>>) {
  const api = session || await ariveSession(); const notes: AriveNote[] = [];
  let expectedCount: number | null = null;
  const priorPageIds = new Set<string>();
  for (let offset = 0; offset < 5000; offset += 100) {
    const data = await api(`/loans/${encodeURIComponent(id)}/notes?limit=100&offset=${offset}`);
    if (!Array.isArray(data.loanNotes) || !Number.isSafeInteger(data.count) || data.count < 0) throw new AriveError('Unexpected Arive notes response.');
    if (expectedCount !== null && data.count !== expectedCount) throw new AriveError('Arive notes changed during pagination. Existing notes were retained.');
    expectedCount = data.count;
    if (data.loanNotes.length > 100 || offset + data.loanNotes.length > data.count
      || offset + data.loanNotes.length < data.count && data.loanNotes.length !== 100) {
      throw new AriveError('Arive notes pagination was incomplete. Existing notes were retained.');
    }
    const page = data.loanNotes.map((n: Record<string, unknown>) => normalizeNote(n));
    // Repeated IDs across pages mean the offset listing moved while we read it.
    // Keep existing numeric/string-ID normalization within one complete page.
    if (page.some((note: AriveNote) => priorPageIds.has(note.id))) throw new AriveError('Arive notes pages overlapped. Existing notes were retained.');
    for (const note of page) priorPageIds.add(note.id);
    notes.push(...page);
    if (offset + data.loanNotes.length === data.count) return [...new Map(notes.map(n => [n.id, n])).values()];
  }
  throw new AriveError('This loan exceeds the pilot note limit. Existing notes were retained.');
}
export function validAriveUploadUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['.amazonaws.com', '.blob.core.windows.net', '.storage.googleapis.com', '.myarive.com'].some(s => host.endsWith(s)) && host !== 'storage.googleapis.com') throw new AriveError('Arive returned an unrecognized upload destination. Ask an administrator to verify it.');
  return url.href;
}
