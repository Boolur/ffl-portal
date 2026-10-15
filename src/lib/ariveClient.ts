import 'server-only';
import { prisma } from '@/lib/prisma';
import { decryptAriveCredentials } from '@/lib/ariveCrypto';

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
async function responseJson(response: Response, operation = 'API request') {
  if (!response.ok) {
    // Return only allowlisted gateway diagnostics, never arbitrary upstream bodies or credentials.
    const knownTypes = new Set(['ForbiddenException', 'MissingAuthenticationTokenException', 'InvalidSignatureException', 'AccessDeniedException', 'UnauthorizedException', 'NotAuthorizedException', 'WAFForbiddenException']);
    const type = response.headers.get('x-amzn-errortype')?.split(':')[0];
    const requestId = response.headers.get('x-amzn-requestid');
    const diagnostics = [type && knownTypes.has(type) ? `Gateway code: ${type}.` : '', requestId && /^[a-zA-Z0-9-]{8,100}$/.test(requestId) ? `Request ID: ${requestId}.` : ''].filter(Boolean).join(' ');
    throw new AriveError(`Arive ${operation} returned HTTP ${response.status}. ${response.status === 401 || response.status === 403 ? 'Check the credentials and Arive-provisioned permission for this operation.' : response.status === 429 ? 'Rate limit reached; try again later.' : 'Please retry or contact your administrator.'}${diagnostics ? ` ${diagnostics}` : ''}`);
  }
  try { return await response.json(); } catch { throw new AriveError('Arive returned an unexpected response.'); }
}
export async function ariveSession(provided?: AriveCredentials) {
  const c = provided || await credentials();
  let auth;
  try { auth = await responseJson(await fetch(`${BASE}/auth/access-token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey }, body: JSON.stringify(c), cache: 'no-store', signal: AbortSignal.timeout(20000), redirect: 'error' }), 'authentication'); }
  catch (e) { if (e instanceof AriveError) throw e; throw new AriveError('Unable to connect to Arive.'); }
  if (typeof auth.AccessToken !== 'string' || !auth.AccessToken) throw new AriveError('Arive did not issue an access token.');
  return async (path: string, body?: object) => {
    try { return await responseJson(await fetch(`${BASE}${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey, Authorization: `Bearer ${auth.AccessToken}` }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(25000), redirect: 'error' }), path === '/loans/document-classifications' ? 'document classification access check' : 'API request'); }
    catch (e) { if (e instanceof AriveError) throw e; throw new AriveError('Arive request did not finish. Check the transfer status before retrying.'); }
  };
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
function normalizeNote(value: Record<string, unknown>, depth = 0): AriveNote {
  if (typeof value.id !== 'string' || typeof value.text !== 'string') throw new AriveError('Arive returned an unexpected note format.');
  return { id: value.id, text: value.text, author: typeof value.createdByName === 'string' ? value.createdByName : 'Arive user', createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '', replies: depth < 3 && Array.isArray(value.nestedNotes) ? value.nestedNotes.map(n => normalizeNote(n, depth + 1)) : [] };
}
export async function readAriveNotes(id: string) {
  const api = await ariveSession(); const notes: AriveNote[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const data = await api(`/loans/${encodeURIComponent(id)}/notes?limit=100&offset=${offset}`);
    if (!Array.isArray(data.loanNotes) || !Number.isInteger(data.count) || data.count < 0) throw new AriveError('Unexpected Arive notes response.');
    notes.push(...data.loanNotes.map((n: Record<string, unknown>) => normalizeNote(n)));
    if (offset + data.loanNotes.length >= data.count) return [...new Map(notes.map(n => [n.id, n])).values()];
    if (!data.loanNotes.length) throw new AriveError('Arive notes pagination was incomplete. Existing notes were retained.');
  }
  throw new AriveError('This loan exceeds the pilot note limit. Existing notes were retained.');
}
export function validAriveUploadUrl(raw: string) {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !['.amazonaws.com', '.blob.core.windows.net', '.storage.googleapis.com', '.myarive.com'].some(s => host.endsWith(s)) && host !== 'storage.googleapis.com') throw new AriveError('Arive returned an unrecognized upload destination. Ask an administrator to verify it.');
  return url.href;
}
