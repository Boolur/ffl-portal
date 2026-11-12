import { describe, expect, it, vi } from 'vitest';
import { decryptAriveCredentials, encryptAriveCredentials } from './ariveCrypto';
import { AriveTransportError, ariveResponseCooldown, ariveTransportFingerprint, createAriveTransportSession, validateAriveProviderAllowance, type AriveRequestReservation, type AriveRuntime, type AriveTransportOptions, type AriveTransportStore, type TransportCredentials } from './ariveTransport';

const serverSecret = 'synthetic-server-encryption-secret-for-tests-only';
function fixture(limit = 100, seconds = 60) {
  let now = Date.parse('2026-11-12T20:00:00Z');
  let credentials: TransportCredentials = { clientId: 'synthetic-client', secret: 'synthetic-secret', apiKey: 'synthetic-api-key' };
  const runtime: AriveRuntime = { id: 'company', enabled: true, providerRequestLimit: limit, providerWindowSeconds: seconds,
    quotaConfirmedAt: new Date(now), quotaKeyFingerprint: ariveTransportFingerprint(credentials, serverSecret, 'key'), cooldownUntil: null,
    encryptedAccessToken: null, accessTokenExpiresAt: null, credentialFingerprint: null, refreshLeaseToken: null, refreshLeaseUntil: null };
  const requests: AriveRequestReservation[] = [];
  let queue = Promise.resolve();
  const store: AriveTransportStore = { async transaction(work) {
    const prior = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await work({
      runtime: async () => ({ ...runtime }), updateRuntime: async patch => { Object.assign(runtime, patch); },
      recentRequests: async (key, since) => { const rows = requests.filter(row => row.keyFingerprint === key && row.startedAt > since); return { count: rows.length, oldest: rows[0]?.startedAt ?? null }; },
      activeRequests: async at => requests.filter(row => !row.finishedAt && row.leaseUntil > at).length,
      createRequest: async value => { requests.push(value); },
      finishRequest: async (id, finishedAt, statusCode) => { Object.assign(requests.find(row => row.id === id)!, { finishedAt, statusCode }); },
    }); } finally { release(); }
  } };
  let issued = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    void init;
    return String(input).endsWith('/auth/access-token') ? Response.json({ AccessToken: `private-token-${++issued}`, ExpiresIn: 3600 }) : Response.json({ ok: true });
  });
  const options: AriveTransportOptions = { store, credentials: async () => ({ ...credentials }), encryptionSecret: serverSecret,
    encrypt: value => encryptAriveCredentials(value, serverSecret), decrypt: value => decryptAriveCredentials(value, serverSecret),
    fetch: fetcher as typeof fetch, now: () => new Date(now), sleep: async ms => { now += ms; await new Promise(resolve => setTimeout(resolve, 0)); },
    parseJson: async response => { if (!response.ok) throw new AriveTransportError('HTTP_ERROR', `Arive returned HTTP ${response.status}.`); return response.json(); } };
  return { runtime, requests, options, fetcher, advance: (ms: number) => { now += ms; }, get now() { return now; },
    rotate: (patch: Partial<TransportCredentials>) => { credentials = { ...credentials, ...patch }; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('shared Arive request budget', () => {
  it.each(['disabled', 'unconfirmed', 'wrong key'])('does not make a request when quota is %s', async reason => {
    const h = fixture();
    if (reason === 'disabled') h.runtime.enabled = false;
    if (reason === 'unconfirmed') h.runtime.quotaConfirmedAt = null;
    if (reason === 'wrong key') h.rotate({ apiKey: 'different-key' });
    await expect(createAriveTransportSession(h.options)).rejects.toBeInstanceOf(AriveTransportError);
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0);
  });
  it('reserves only 80% of a confirmed rolling allowance, including authentication', async () => {
    const h = fixture(5, 60); const api = await createAriveTransportSession(h.options);
    for (let n = 0; n < 3; n++) await api('/loans/test');
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(h.requests.map(row => row.kind)).toEqual(['AUTH', 'GET', 'GET', 'GET']);
    expect(h.fetcher).toHaveBeenCalledTimes(4);
    h.advance(60_001); await api('/loans/test');
    expect(h.fetcher).toHaveBeenCalledTimes(5);
  });
  it('allows at most two global active requests across separate session instances', async () => {
    const h = fixture(); const first = await createAriveTransportSession(h.options); const second = await createAriveTransportSession(h.options);
    const pending = [deferred<Response>(), deferred<Response>()]; let index = 0;
    h.fetcher.mockImplementation(() => pending[index++].promise);
    const one = first('/loans/one'); const two = second('/loans/two');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    await expect(second('/loans/three')).rejects.toMatchObject({ code: 'BUSY' });
    expect(h.requests.filter(row => !row.finishedAt)).toHaveLength(2);
    pending.forEach(item => item.resolve(Response.json({ ok: true }))); await Promise.all([one, two]);
    expect(h.requests.every(row => row.finishedAt)).toBe(true);
  });
  it('retains failed attempts in the budget and releases their concurrency slot', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    h.fetcher.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(api('/loans/test')).rejects.toThrow('Network unavailable');
    expect(h.requests).toHaveLength(2); expect(h.requests[1].finishedAt).not.toBeNull();
    await api('/loans/test'); expect(h.requests).toHaveLength(3);
  });
  it('expires abandoned request leases without forgetting that their attempts consumed quota', async () => {
    const h = fixture(5, 60); const api = await createAriveTransportSession(h.options);
    const old = { ...h.requests[0], kind: 'GET', finishedAt: null, startedAt: new Date(h.now - 50_000), leaseUntil: new Date(h.now - 1000) };
    h.requests.push({ ...old, id: 'abandoned-one' }, { ...old, id: 'abandoned-two' });
    await api('/loans/test');
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
  });
  it('persists the longest provider cooldown and blocks other sessions without another API request', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    h.fetcher.mockResolvedValueOnce(new Response('private upstream text', { status: 429, headers: { 'Retry-After': '30', 'X-RateLimit-Reset': String(h.now / 1000 + 90) } }));
    await expect(api('/loans/test')).rejects.toThrow('HTTP 429');
    expect(h.runtime.cooldownUntil?.getTime()).toBe(h.now + 90_000);
    const other = await createAriveTransportSession(h.options);
    await expect(other('/loans/test')).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.advance(90_001); await other('/loans/test'); expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it('counts and applies cooldown to authentication failures too', async () => {
    const h = fixture(); h.fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'ratelimit-reset': '120' } }));
    await expect(createAriveTransportSession(h.options)).rejects.toThrow('HTTP 429');
    await expect(createAriveTransportSession(h.options)).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.requests[0].statusCode).toBe(429); expect(h.runtime.refreshLeaseToken).toBeNull();
  });
});

describe('shared encrypted Arive tokens', () => {
  it('shares a single refresh across concurrent sessions and stores only encrypted token material', async () => {
    const h = fixture(); await Promise.all([createAriveTransportSession(h.options), createAriveTransportSession(h.options)]);
    expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.requests).toHaveLength(1);
    expect(h.runtime.encryptedAccessToken).toMatch(/^v1\./); expect(JSON.stringify(h.runtime)).not.toContain('private-token');
    expect(decryptAriveCredentials(h.runtime.encryptedAccessToken!, serverSecret)).toBe('private-token-1');
    expect(h.runtime.refreshLeaseToken).toBeNull();
  });
  it('refreshes expiring tokens with a safety margin', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options); h.advance(3_550_000);
    await api('/loans/test'); expect(h.requests.map(row => row.kind)).toEqual(['AUTH', 'AUTH', 'GET']);
  });
  it('invalidates tokens on secret rotation without resetting same-key request usage', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options); const prior = h.runtime.credentialFingerprint;
    h.rotate({ secret: 'new-secret' }); await api('/loans/test');
    expect(h.runtime.credentialFingerprint).not.toBe(prior);
    expect(h.requests.map(row => row.kind)).toEqual(['AUTH', 'AUTH', 'GET']);
    expect(h.fetcher.mock.calls[2][1]?.headers).toMatchObject({ Authorization: 'Bearer private-token-2' });
  });
  it('refuses a rotated API key until its quota is confirmed', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options); h.rotate({ apiKey: 'new-key' });
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'QUOTA_UNCONFIRMED' }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('never reuses or populates the saved cache for explicit-credential diagnostics', async () => {
    const h = fixture(); await createAriveTransportSession(h.options); const cache = h.runtime.encryptedAccessToken;
    h.rotate({ secret: 'diagnostic-secret' });
    await createAriveTransportSession({ ...h.options, freshAuthentication: true });
    await createAriveTransportSession({ ...h.options, freshAuthentication: true });
    expect(h.requests.map(row => row.kind)).toEqual(['AUTH', 'AUTH', 'AUTH']);
    expect(h.runtime.encryptedAccessToken).toBe(cache);
    expect(JSON.parse(String(h.fetcher.mock.calls[1][1]?.body)).secret).toBe('diagnostic-secret');
  });
  it('reclaims an expired token refresh lease', async () => {
    const h = fixture(); h.runtime.credentialFingerprint = ariveTransportFingerprint(await h.options.credentials(), serverSecret, 'credentials');
    h.runtime.refreshLeaseToken = 'crashed-worker'; h.runtime.refreshLeaseUntil = new Date(h.now - 1);
    await createAriveTransportSession(h.options); expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not cache a token if the saved credentials rotate while authentication is running', async () => {
    const h = fixture(); const result = deferred<Response>(); h.fetcher.mockImplementationOnce(() => result.promise);
    const session = createAriveTransportSession(h.options);
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(1)); h.rotate({ secret: 'rotated-during-auth' });
    result.resolve(Response.json({ AccessToken: 'obsolete-private-token', ExpiresIn: 3600 }));
    await expect(session).rejects.toMatchObject({ code: 'CREDENTIALS_CHANGED' });
    expect(h.runtime.encryptedAccessToken).toBeNull(); expect(h.runtime.refreshLeaseToken).toBeNull();
  });
  it.each([undefined, 0, 30, '3600', 90000])('rejects invalid token expiration %s without caching it', async expiry => {
    const h = fixture(); h.fetcher.mockResolvedValueOnce(Response.json({ AccessToken: 'private-token', ExpiresIn: expiry }));
    await expect(createAriveTransportSession(h.options)).rejects.toMatchObject({ code: 'INVALID_TOKEN' }); expect(h.runtime.encryptedAccessToken).toBeNull();
  });
});

describe('bounded retries and read-only rollout', () => {
  it('retries a GET 401 once with a fresh token and budgets every attempt', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(api('/loans/test')).resolves.toEqual({ ok: true });
    expect(h.requests.map(row => row.kind)).toEqual(['AUTH', 'GET', 'AUTH', 'GET_RETRY']);
    expect(h.fetcher.mock.calls[3][1]?.headers).toMatchObject({ Authorization: 'Bearer private-token-2' });
  });
  it('stops after the second GET 401', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(Response.json({ AccessToken: 'fresh-token', ExpiresIn: 3600 })).mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(api('/loans/test')).rejects.toThrow('HTTP 401'); expect(h.fetcher).toHaveBeenCalledTimes(4);
  });
  it.each([undefined, 'PATCH'] as const)('never replays a write after HTTP 401 (%s)', async method => {
    const h = fixture(); const api = await createAriveTransportSession(h.options); h.fetcher.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(api('/loans/test', { synthetic: true }, method)).rejects.toThrow('HTTP 401'); expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it('prevents the broad worker from making any loan write or changing origin', async () => {
    const h = fixture(); const api = await createAriveTransportSession({ ...h.options, readOnly: true });
    await expect(api('/loans/test', {})).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(api('/loans/test', undefined, 'PATCH')).rejects.toMatchObject({ code: 'READ_ONLY' });
    await expect(api('https://other.example/private')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('provider quota and cooldown parsing', () => {
  it('requires explicit integer quota settings and applies the fixed 80% reserve', () => {
    expect(validateAriveProviderAllowance(100, 60)).toEqual({ limit: 100, seconds: 60, allowance: 80 });
    for (const [limit, seconds] of [[1, 60], [100, 0], [1.5, 60], ['100', 60], [100, Infinity]]) expect(() => validateAriveProviderAllowance(limit, seconds)).toThrow();
  });
  it('honors seconds, HTTP dates, and reset headers without shortening the longest cooldown', () => {
    const now = new Date('2026-11-12T20:00:00Z');
    expect(ariveResponseCooldown(new Headers({ 'Retry-After': 'Thu, 12 Nov 2026 20:02:00 GMT' }), now).toISOString()).toBe('2026-11-12T20:02:00.000Z');
    expect(ariveResponseCooldown(new Headers({ 'Retry-After': '30', 'RateLimit-Reset': '90' }), now).getTime()).toBe(now.getTime() + 90_000);
    expect(ariveResponseCooldown(new Headers({ 'Retry-After': 'malformed' }), now).getTime()).toBe(now.getTime() + 60_000);
  });
});
