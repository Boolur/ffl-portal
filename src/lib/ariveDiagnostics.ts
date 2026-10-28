import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { AriveCredentials } from './ariveClient';

const EGRESS_ENDPOINT = 'https://checkip.amazonaws.com';
const FIELDS = ['clientId', 'secret', 'apiKey', 'request'] as const;
type ComparisonField = (typeof FIELDS)[number];
export type AriveCredentialMatches = Record<ComparisonField, boolean>;
export type AriveComparisonCode = {
  version: 1;
  challenge: string;
  fingerprints: Record<ComparisonField, string>;
};
export type AriveEgressDiagnostic = {
  checkedAt: string;
  region: string;
  deployment: string;
  node: string;
  samples: { ip: string | null; error: string | null }[];
};
export type AriveCredentialDiagnostic = {
  matches: AriveCredentialMatches;
  authentication: { attempted: boolean; ok: boolean; message: string };
  egress: AriveEgressDiagnostic;
};

export class AriveDiagnosticInputError extends Error {}

export function normalizeDiagnosticCredentials(input: unknown): AriveCredentials {
  if (!input || typeof input !== 'object') throw new AriveDiagnosticInputError('Enter all three actual Arive credentials.');
  const fields = input as Record<string, unknown>;
  const normalized = {} as AriveCredentials;
  for (const name of ['clientId', 'secret', 'apiKey'] as const) {
    const raw = fields[name];
    if (typeof raw !== 'string' || /[\r\n]/.test(raw)) throw new AriveDiagnosticInputError('Enter each actual Arive credential without line breaks.');
    const value = raw.trim();
    if (!value || value.length > 4096) throw new AriveDiagnosticInputError('Enter all three actual Arive credentials.');
    if (/^(?:<redacted>|\[redacted\]|redacted)$/i.test(value) || /^[*\u2022\u25cf\u25e6\u2219\u00b7\u25aa\u25a0]+$/u.test(value) || /^[xX]{4,}$/.test(value)) {
      throw new AriveDiagnosticInputError('Masked or redacted placeholders cannot be tested. Paste the actual credentials directly into the form.');
    }
    normalized[name] = value;
  }
  return normalized;
}

export function parseAriveComparisonCode(raw: unknown): AriveComparisonCode {
  const invalid = () => new AriveDiagnosticInputError('Enter a valid comparison code from the local diagnostic.');
  if (typeof raw !== 'string' || raw.length > 2048) throw invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'challenge,fingerprints,version' || value.version !== 1 || typeof value.challenge !== 'string' || !/^[0-9a-f]{64}$/.test(value.challenge)) throw invalid();
  if (!value.fingerprints || typeof value.fingerprints !== 'object' || Array.isArray(value.fingerprints)) throw invalid();
  const fingerprints = value.fingerprints as Record<string, unknown>;
  if (Object.keys(fingerprints).sort().join(',') !== [...FIELDS].sort().join(',')) throw invalid();
  for (const name of FIELDS) {
    if (typeof fingerprints[name] !== 'string' || !/^[0-9a-f]{64}$/.test(fingerprints[name] as string)) throw invalid();
  }
  return { version: 1, challenge: value.challenge, fingerprints: fingerprints as Record<ComparisonField, string> };
}

export function compareAriveCredentials(credentials: AriveCredentials, code: AriveComparisonCode): AriveCredentialMatches {
  const key = Buffer.from(code.challenge, 'hex');
  // Preserve the exact request field order shared with the local comparison tool.
  const request = JSON.stringify({ clientId: credentials.clientId, secret: credentials.secret, apiKey: credentials.apiKey });
  const matches = {} as AriveCredentialMatches;
  for (const name of FIELDS) {
    const value = name === 'request' ? request : credentials[name];
    const actual = createHmac('sha256', key).update(JSON.stringify(['arive-diagnostic-v1', name, value]), 'utf8').digest();
    matches[name] = timingSafeEqual(actual, Buffer.from(code.fingerprints[name], 'hex'));
  }
  return matches;
}

async function readEgressAddress(response: Response): Promise<string | null> {
  if (!response.body) return null;
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 128)) { await response.body.cancel(); return null; }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return isIP(text) ? text : null;
}

export async function collectAriveEgressDiagnostic(): Promise<AriveEgressDiagnostic> {
  const samples: AriveEgressDiagnostic['samples'] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(EGRESS_ENDPOINT, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!response.ok || response.redirected) {
        await response.body?.cancel();
        samples.push({ ip: null, error: 'The IP check did not return a successful direct response.' });
        continue;
      }
      const ip = await readEgressAddress(response);
      samples.push({ ip, error: ip ? null : 'The IP check returned an invalid or oversized response.' });
    } catch { samples.push({ ip: null, error: 'The IP check could not be completed.' }); }
  }
  const rawRegion = process.env.VERCEL_REGION || '';
  const rawDeployment = process.env.VERCEL_GIT_COMMIT_SHA || '';
  return {
    checkedAt: new Date().toISOString(),
    region: /^[a-z0-9-]{1,32}$/i.test(rawRegion) ? rawRegion : 'unknown',
    deployment: /^[a-f0-9]{40}$/i.test(rawDeployment) ? rawDeployment : 'unknown',
    node: process.version,
    samples,
  };
}
