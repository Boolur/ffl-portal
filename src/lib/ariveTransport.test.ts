import { describe, expect, it, vi } from 'vitest';
import { decryptAriveCredentials, encryptAriveCredentials } from './ariveCrypto';
import { AriveTransportError, ariveResponseCooldown, ariveTransportFingerprint, createAriveTransportSession, validateAriveOperatorBudget, validateAriveProviderAllowance, type AriveRequestReservation, type AriveRuntime, type AriveTransportOptions, type AriveTransportStore, type TransportCredentials } from './ariveTransport';

const serverSecret = 'synthetic-server-encryption-secret-for-tests-only';
function fixture(limit = 100, seconds = 60) {
  let now = Date.parse('2026-11-12T20:00:00Z');
  let credentials: TransportCredentials = { clientId: 'synthetic-client', secret: 'synthetic-secret', apiKey: 'synthetic-api-key' };
  const runtime: AriveRuntime = { id: 'company', enabled: true, providerRequestLimit: limit, providerWindowSeconds: seconds,
    quotaConfirmedAt: new Date(now), quotaKeyFingerprint: ariveTransportFingerprint(credentials, serverSecret, 'key'), cooldownUntil: null,
    encryptedAccessToken: null, accessTokenExpiresAt: null, credentialFingerprint: null, refreshLeaseToken: null, refreshLeaseUntil: null };
  const requests: AriveRequestReservation[] = [];
  let queue = Promise.resolve();
  const store: AriveTransportStore = {
    finishRequest: async (id, finishedAt, statusCode) => {
      const row = requests.find(row => row.id === id && row.connectionId === 'company' && !row.finishedAt);
      if (row) Object.assign(row, { finishedAt, statusCode });
    },
    async transaction(work) {
    const prior = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; });
    await prior;
    try { return await work({
      runtime: async () => ({ ...runtime }), updateRuntime: async patch => { Object.assign(runtime, patch); },
      recentRequests: async (key, since) => { const rows = requests.filter(row => row.keyFingerprint === key && row.startedAt > since); return { count: rows.length, oldest: rows[0]?.startedAt ?? null }; },
      activeRequests: async at => requests.filter(row => !row.finishedAt && row.leaseUntil > at).length,
      createRequest: async value => { requests.push(value); },
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
function operatorFixture(limit = 120) {
  const h = fixture();
  Object.assign(h.runtime, { allowanceSource: 'OPERATOR_AUTHORIZED', operatorRequestLimit: limit,
    operatorAuthorizedAt: new Date(h.now), operatorAuthorizedById: 'admin-test', quotaConfirmedAt: null });
  return h;
}

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
  it('lets an unreserved third call wait for a global slot without sending or charging retries', async () => {
    const h = fixture(); const first = await createAriveTransportSession(h.options);
    const pending = [deferred<Response>(), deferred<Response>()]; let index = 0; let maxActive = 0;
    h.fetcher.mockImplementation(async () => {
      maxActive = Math.max(maxActive, h.requests.filter(row => !row.finishedAt).length);
      return index < 2 ? pending[index++].promise : Response.json({ ok: true });
    });
    const one = first('/loans/one'); const two = first('/loans/two');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    const waited = deferred<boolean>(); const releaseWait = deferred<boolean>();
    const sleep = vi.fn(async () => { waited.resolve(true); await releaseWait.promise; });
    const other = await createAriveTransportSession({ ...h.options, sleep });
    const third = other('/loans/three'); await waited.promise;
    expect(h.fetcher).toHaveBeenCalledTimes(3); expect(h.requests).toHaveLength(3);
    pending[0].resolve(Response.json({ ok: true })); await one; releaseWait.resolve(true);
    await expect(third).resolves.toEqual({ ok: true });
    expect(maxActive).toBe(2); expect(h.requests).toHaveLength(4); expect(sleep).toHaveBeenCalledTimes(1);
    pending[1].resolve(Response.json({ ok: true })); await two;
  });
  it.each([true, false])('bounds a busy wait when its injected clock advances: %s', async advances => {
    const h = fixture(); const first = await createAriveTransportSession(h.options);
    const sleep = vi.fn(async (ms: number) => { if (advances) h.advance(ms); });
    const other = await createAriveTransportSession({ ...h.options, sleep });
    const pending = [deferred<Response>(), deferred<Response>()]; let index = 0;
    h.fetcher.mockImplementation(() => pending[index++].promise);
    const one = first('/loans/one'); const two = first('/loans/two');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    const started = h.now;
    await expect(other('/loans/three')).rejects.toMatchObject({ code: 'BUSY' });
    expect(sleep).toHaveBeenCalledTimes(12); expect(h.now - started).toBeLessThanOrEqual(5000);
    expect(h.requests).toHaveLength(3); expect(h.fetcher).toHaveBeenCalledTimes(3);
    pending.forEach(item => item.resolve(Response.json({ ok: true }))); await Promise.all([one, two]);
  });
  it.each(['pause', 'cooldown', 'key', 'budget'])('rechecks %s after waiting for a slot', async change => {
    const h = fixture(); const first = await createAriveTransportSession(h.options);
    const pending = [deferred<Response>(), deferred<Response>()]; let index = 0;
    h.fetcher.mockImplementation(() => pending[index++].promise);
    const one = first('/loans/one'); const two = first('/loans/two');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    const sleep = vi.fn(async () => {
      pending[0].resolve(Response.json({ ok: true })); await one;
      if (change === 'pause') h.runtime.enabled = false;
      if (change === 'cooldown') h.runtime.cooldownUntil = new Date(h.now + 60_000);
      if (change === 'key') h.runtime.quotaKeyFingerprint = 'replacement-key';
      if (change === 'budget') h.runtime.providerRequestLimit = 2;
    });
    const other = await createAriveTransportSession({ ...h.options, sleep });
    await expect(other('/loans/three')).rejects.toMatchObject({ code: { pause: 'DISABLED', cooldown: 'COOLDOWN', key: 'QUOTA_UNCONFIRMED', budget: 'BUDGET_EXHAUSTED' }[change] });
    expect(h.fetcher).toHaveBeenCalledTimes(3); expect(h.requests).toHaveLength(3);
    pending[1].resolve(Response.json({ ok: true })); await two;
  });
  it('retains failed attempts in the budget and releases their concurrency slot', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    h.fetcher.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(api('/loans/test')).rejects.toThrow('Network unavailable');
    expect(h.requests).toHaveLength(2); expect(h.requests[1].finishedAt).not.toBeNull();
    await api('/loans/test'); expect(h.requests).toHaveLength(3);
  });
  it('releases a completed reservation without waiting for the admission lock or erasing its request usage', async () => {
    const h = fixture(5); const api = await createAriveTransportSession(h.options);
    const response = deferred<Response>(); h.fetcher.mockImplementationOnce(() => response.promise);
    const result = api('/loans/test');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    const entered = deferred<boolean>(); const release = deferred<boolean>();
    const admission = h.options.store.transaction(async () => { entered.resolve(true); await release.promise; });
    await entered.promise;
    let completed = false; void result.then(() => { completed = true; });
    try {
      response.resolve(Response.json({ ok: true }));
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(h.requests).toHaveLength(2); expect(h.requests.every(row => row.finishedAt)).toBe(true);
    } finally { release.resolve(true); await admission; }
    await api('/loans/test'); await api('/loans/test');
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(h.requests).toHaveLength(4);
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
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'COOLDOWN', retryAt: new Date(h.now + 90_000) });
    expect(h.runtime.cooldownUntil?.getTime()).toBe(h.now + 90_000);
    const other = await createAriveTransportSession(h.options);
    await expect(other('/loans/test')).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.advance(90_001); await other('/loans/test'); expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it('counts and applies cooldown to authentication failures too', async () => {
    const h = fixture(); h.fetcher.mockResolvedValue(new Response('', { status: 429, headers: { 'ratelimit-reset': '120' } }));
    await expect(createAriveTransportSession(h.options)).rejects.toMatchObject({ code: 'COOLDOWN' });
    await expect(createAriveTransportSession(h.options)).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.fetcher).toHaveBeenCalledTimes(1); expect(h.requests[0].statusCode).toBe(429); expect(h.runtime.refreshLeaseToken).toBeNull();
  });
  it.each(['authentication', 'loan read'])('returns typed throttling before a generic HTTP parser during %s', async operation => {
    const h = fixture();
    const parseJson = vi.fn(async (response: Response) => {
      if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
      return response.json();
    });
    const options = { ...h.options, parseJson };
    const api = operation === 'loan read' ? await createAriveTransportSession(options) : null;
    parseJson.mockClear();
    h.fetcher.mockResolvedValueOnce(new Response('sensitive provider body', { status: 429, headers: { 'Retry-After': '45' } }));
    await expect(api ? api('/loans/test') : createAriveTransportSession(options)).rejects.toMatchObject({
      name: 'AriveTransportError', code: 'COOLDOWN', retryAt: new Date(h.now + 45_000),
    });
    expect(parseJson).not.toHaveBeenCalled();
    expect(h.runtime.cooldownUntil).toEqual(new Date(h.now + 45_000));
    expect(h.requests.at(-1)).toMatchObject({ statusCode: 429, finishedAt: new Date(h.now) });
  });
  it('returns the longest already persisted cooldown when another in-flight response asks for less', async () => {
    const h = fixture(); const api = await createAriveTransportSession(h.options);
    const pending = deferred<Response>(); h.fetcher.mockImplementationOnce(() => pending.promise);
    const result = api('/loans/test');
    const expected = expect(result).rejects.toMatchObject({ code: 'COOLDOWN', retryAt: new Date(h.now + 90_000) });
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    h.runtime.cooldownUntil = new Date(h.now + 90_000);
    pending.resolve(new Response('', { status: 429, headers: { 'Retry-After': '10' } })); await expected;
    expect(h.runtime.cooldownUntil).toEqual(new Date(h.now + 90_000));
  });
});

describe('operator-authorized request ceilings', () => {
  it('shares an exact minute ceiling across instances, including authentication and writes', async () => {
    const h = operatorFixture(10); const first = await createAriveTransportSession(h.options);
    const second = await createAriveTransportSession(h.options);
    for (let i = 0; i < 9; i++) await (i % 2 ? first : second)('/loans/test', i === 3 ? { synthetic: true } : undefined);
    await expect(second('/loans/test')).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(h.fetcher).toHaveBeenCalledTimes(10); expect(h.requests).toHaveLength(10);
    expect(h.requests.filter(row => row.kind === 'AUTH')).toHaveLength(1);
    expect(h.requests.filter(row => row.kind === 'POST')).toHaveLength(1);
    expect(h.runtime.quotaConfirmedAt).toBeNull(); expect(h.runtime.providerRequestLimit).toBe(100);
    h.advance(60_001); await second('/loans/test'); expect(h.fetcher).toHaveBeenCalledTimes(11);
  });
  it.each(['missing actor', 'missing date', 'future date', 'invalid date', 'wrong key', 'invalid cap', 'unknown mode'])('refuses %s before authentication', async invalid => {
    const h = operatorFixture();
    if (invalid === 'missing actor') h.runtime.operatorAuthorizedById = null;
    if (invalid === 'missing date') h.runtime.operatorAuthorizedAt = null;
    if (invalid === 'future date') h.runtime.operatorAuthorizedAt = new Date(h.now + 1);
    if (invalid === 'invalid date') h.runtime.operatorAuthorizedAt = new Date('invalid');
    if (invalid === 'wrong key') h.rotate({ apiKey: 'new-key' });
    if (invalid === 'invalid cap') h.runtime.operatorRequestLimit = 601;
    if (invalid === 'unknown mode') h.runtime.allowanceSource = 'UNVERIFIED';
    await expect(createAriveTransportSession(h.options)).rejects.toBeInstanceOf(AriveTransportError);
    expect(h.fetcher).not.toHaveBeenCalled(); expect(h.requests).toHaveLength(0);
  });
  it('requires authorization for a rotated API key and never treats a saved provider quota as authorization', async () => {
    const h = operatorFixture(); const api = await createAriveTransportSession(h.options);
    h.rotate({ apiKey: 'replacement-key' }); h.runtime.quotaConfirmedAt = new Date(h.now);
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'OPERATOR_BUDGET_UNAUTHORIZED' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('halves the persistent ceiling once per cooldown episode across concurrent responses', async () => {
    const h = operatorFixture(120); const api = await createAriveTransportSession(h.options);
    const pending = [deferred<Response>(), deferred<Response>()]; let index = 0;
    h.fetcher.mockImplementation(() => pending[index++].promise);
    const one = api('/loans/one'); const two = api('/loans/two');
    const rejectedOne = expect(one).rejects.toMatchObject({ code: 'COOLDOWN' }); const rejectedTwo = expect(two).rejects.toMatchObject({ code: 'COOLDOWN' });
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(3));
    pending[0].resolve(new Response('', { status: 429, headers: { 'Retry-After': '30' } })); await rejectedOne;
    expect(h.runtime.operatorRequestLimit).toBe(60);
    pending[1].resolve(new Response('', { status: 429, headers: { 'Retry-After': '90' } })); await rejectedTwo;
    expect(h.runtime.operatorRequestLimit).toBe(60); expect(h.runtime.cooldownUntil?.getTime()).toBe(h.now + 90_000);
    expect(h.runtime.providerRequestLimit).toBe(100); expect(h.runtime.quotaConfirmedAt).toBeNull();
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.fetcher).toHaveBeenCalledTimes(3);
    h.advance(90_001); h.fetcher.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    await expect(api('/loans/test')).rejects.toMatchObject({ code: 'COOLDOWN' }); expect(h.runtime.operatorRequestLimit).toBe(30);
    h.advance(1001); h.fetcher.mockResolvedValueOnce(Response.json({ ok: true })); await api('/loans/test');
    expect(h.runtime.operatorRequestLimit).toBe(30);
  });
  it('applies the 10-request minimum to authentication throttling without automatic increases', async () => {
    const h = operatorFixture(15);
    h.fetcher.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    await expect(createAriveTransportSession(h.options)).rejects.toMatchObject({ code: 'COOLDOWN' });
    expect(h.runtime.operatorRequestLimit).toBe(10); expect(h.requests[0].statusCode).toBe(429);
    h.advance(1001); const api = await createAriveTransportSession(h.options); await api('/loans/test');
    expect(h.runtime.operatorRequestLimit).toBe(10);
  });
  it.each(['key', 'authorization'])('does not lower newer %s settings from an in-flight throttled response', async change => {
    const h = operatorFixture(); const api = await createAriveTransportSession(h.options);
    const pending = deferred<Response>(); h.fetcher.mockImplementationOnce(() => pending.promise);
    const request = api('/loans/test'); const rejected = expect(request).rejects.toMatchObject({ code: 'COOLDOWN' });
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    if (change === 'key') h.runtime.quotaKeyFingerprint = 'new-key-fingerprint';
    else h.runtime.operatorAuthorizedAt = new Date(h.now + 1);
    pending.resolve(new Response('', { status: 429, headers: { 'Retry-After': '30' } })); await rejected;
    expect(h.runtime.operatorRequestLimit).toBe(120);
    expect(h.runtime.cooldownUntil?.getTime() ?? null).toBe(change === 'key' ? null : h.now + 30_000);
  });
  it('validates the operator ceiling independently from the provider reserve', () => {
    expect(validateAriveOperatorBudget(10)).toEqual({ limit: 10, seconds: 60, allowance: 10 });
    expect(validateAriveOperatorBudget(600)).toEqual({ limit: 600, seconds: 60, allowance: 600 });
    for (const value of [9, 601, 10.5, '120', null, Infinity]) expect(() => validateAriveOperatorBudget(value)).toThrow();
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
