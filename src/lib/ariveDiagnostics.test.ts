import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { collectAriveEgressDiagnostic, compareAriveCredentials, normalizeDiagnosticCredentials, parseAriveComparisonCode } from './ariveDiagnostics';

// Cross-checked independently with the local helper and Python's hmac implementation.
const credentials = { clientId: 'synthetic-client', secret: 'synthetic-"quoted"\\secret+with/=symbols', apiKey: 'synthetic-api-key' };
const comparison = {
  version: 1 as const, challenge: '0123456789abcdef'.repeat(4), fingerprints: {
    clientId: '85e51f4983d046e8a5119c60e0b821e70a5af4c1e1f3098449433cff0885f5ed',
    secret: '1d6764f207042a75478c56523d0b7ea5ce77cee1d7d3cc79c136a15614d95be6',
    apiKey: 'afc7a89f7826d75f77cf70e82fa4be3c47f09ac024e12941aa19b60d85a74308',
    request: '4a3a9e60c355388cccebe72d413a996d72c9a846c6ccad090f39eaf391765e4a',
  },
};
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Arive credential comparison', () => {
  it('matches the independent local-tool vector including special characters and normalized request order', () => {
    const normalized = normalizeDiagnosticCredentials({ apiKey: ` ${credentials.apiKey} `, secret: ` ${credentials.secret} `, clientId: ` ${credentials.clientId} `, testOnly: true });
    expect(Object.keys(normalized)).toEqual(['clientId', 'secret', 'apiKey']);
    expect(compareAriveCredentials(normalized, parseAriveComparisonCode(JSON.stringify(comparison)))).toEqual({ clientId: true, secret: true, apiKey: true, request: true });
  });
  it('distinguishes individual fields and whole-request equality without returning computed fingerprints', () => {
    const result = compareAriveCredentials({ ...credentials, secret: 'different' }, comparison);
    expect(result).toEqual({ clientId: true, secret: false, apiKey: true, request: false });
    expect(JSON.stringify(result)).not.toContain(credentials.secret);
    expect(JSON.stringify(result)).not.toContain(comparison.fingerprints.clientId);
  });
  it.each(['clientId', 'secret', 'apiKey'] as const)('rejects masked, malformed and missing %s before comparison', name => {
    for (const value of ['', ' ', '<redacted>', ' <REDACTED> ', '[redacted]', 'redacted', '********', '••••••', '●*•', 'xxxxxxxx', 'a\nb', 'a\rb', 'a'.repeat(4097), 123, null]) {
      expect(() => normalizeDiagnosticCredentials({ ...credentials, [name]: value })).toThrow();
    }
    expect(() => normalizeDiagnosticCredentials(null)).toThrow();
  });
  it('rejects malformed versions, challenges, fingerprint lengths and unrecognized fields', () => {
    for (const raw of [null, '', 'not-json', 'null', '[]', 'x'.repeat(2049), JSON.stringify({ ...comparison, version: 2 }), JSON.stringify({ ...comparison, challenge: 'aa' }), JSON.stringify({ ...comparison, challenge: 'G'.repeat(64) }), JSON.stringify({ ...comparison, extra: 'unexpected' }), JSON.stringify({ ...comparison, fingerprints: { ...comparison.fingerprints, secret: 'a' } }), JSON.stringify({ ...comparison, fingerprints: { ...comparison.fingerprints, extra: 'a'.repeat(64) } })]) {
      expect(() => parseAriveComparisonCode(raw)).toThrow('Enter a valid comparison code');
    }
  });
});

describe('Arive egress sampling', () => {
  it('makes exactly three sequential bounded requests to the fixed IP endpoint without credentials', async () => {
    let active = 0;
    let peak = 0;
    const fetcher = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return new Response('155.121.192.4\n');
    });
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('VERCEL_REGION', 'iad1');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'a'.repeat(40));
    const result = await collectAriveEgressDiagnostic();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);
    for (const call of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[0]).toBe('https://checkip.amazonaws.com');
      expect(call[1]).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) });
      expect(call[1].headers).toBeUndefined();
      expect(call[1].body).toBeUndefined();
    }
    expect(result).toMatchObject({ region: 'iad1', deployment: 'a'.repeat(40), node: process.version, samples: Array(3).fill({ ip: '155.121.192.4', error: null }) });
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
  });
  it('accepts validated IPv6 and rejects malformed IPs and provider text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('2001:db8::1\n')).mockResolvedValueOnce(new Response('155.121.192.999')).mockResolvedValueOnce(new Response('PRIVATE_PROVIDER_BODY')));
    const result = await collectAriveEgressDiagnostic();
    expect(result.samples[0]).toEqual({ ip: '2001:db8::1', error: null });
    expect(result.samples.slice(1).every(s => s.ip === null && !!s.error)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_BODY');
  });
  it('enforces both declared and streamed body caps and preserves partial samples on timeout', async () => {
    const cancel = vi.fn();
    const oversized = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(129)); }, cancel });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('155.121.192.4', { headers: { 'content-length': '129' } })).mockResolvedValueOnce(new Response(oversized)).mockRejectedValueOnce(new Error('private transport diagnostics')));
    const result = await collectAriveEgressDiagnostic();
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.samples.every(s => s.ip === null && !!s.error)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private transport');
  });
  it('rejects redirects and non-success HTTP responses without exposing their content', async () => {
    const redirected = new Response('155.121.192.4');
    Object.defineProperty(redirected, 'redirected', { value: true });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('private', { status: 302, headers: { location: 'https://untrusted.invalid' } })).mockResolvedValueOnce(redirected).mockResolvedValueOnce(new Response('private', { status: 500 })));
    const result = await collectAriveEgressDiagnostic();
    expect(result.samples.every(s => s.ip === null && !!s.error)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('untrusted');
  });
});
