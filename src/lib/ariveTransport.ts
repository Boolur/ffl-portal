import { createHmac, randomUUID } from 'node:crypto';

export type TransportCredentials = { clientId: string; secret: string; apiKey: string };
export type AriveRuntime = {
  id: string; enabled: boolean; providerRequestLimit: number | null; providerWindowSeconds: number | null;
  quotaConfirmedAt: Date | null; quotaKeyFingerprint: string | null; cooldownUntil: Date | null;
  encryptedAccessToken: string | null; accessTokenExpiresAt: Date | null; credentialFingerprint: string | null;
  refreshLeaseToken: string | null; refreshLeaseUntil: Date | null;
  // Optional for snapshots created before the additive budget-mode migration.
  allowanceSource?: string;
  operatorRequestLimit?: number | null;
  operatorAuthorizedAt?: Date | null;
  operatorAuthorizedById?: string | null;
};
export type AriveRequestReservation = { id: string; connectionId: string; keyFingerprint: string; kind: string; startedAt: Date; leaseUntil: Date; finishedAt: Date | null; statusCode: number | null };
export type AriveTransportTransaction = {
  runtime(): Promise<AriveRuntime | null>;
  updateRuntime(patch: Partial<AriveRuntime>): Promise<void>;
  recentRequests(key: string, since: Date): Promise<{ count: number; oldest: Date | null }>;
  activeRequests(now: Date): Promise<number>;
  createRequest(request: AriveRequestReservation): Promise<void>;
};
export type AriveTransportStore = {
  transaction<T>(work: (tx: AriveTransportTransaction) => Promise<T>): Promise<T>;
  // Completion only releases this reservation; it does not alter budget history.
  finishRequest(id: string, finishedAt: Date, status: number | null): Promise<void>;
};
export class AriveTransportError extends Error {
  constructor(public code: string, message: string, public retryAt: Date | null = null) { super(message); this.name = 'AriveTransportError'; }
}
const BASE = 'https://gwapiconnect.myarive.com/api';
const REQUEST_LEASE_MS = 45_000;
const TOKEN_LEASE_MS = 60_000;
const TOKEN_SKEW_MS = 60_000;

export function ariveTransportFingerprint(credentials: TransportCredentials, encryptionSecret: string, kind: 'key' | 'credentials') {
  if (encryptionSecret.length < 32) throw new AriveTransportError('ENCRYPTION_UNAVAILABLE', 'Server encryption configuration is unavailable.');
  return createHmac('sha256', encryptionSecret).update(JSON.stringify(['arive-transport-v1', kind,
    kind === 'key' ? credentials.apiKey : [credentials.clientId, credentials.secret, credentials.apiKey]])).digest('hex');
}

export function validateAriveProviderAllowance(limit: unknown, seconds: unknown) {
  if (!Number.isSafeInteger(limit) || Number(limit) < 2 || Number(limit) > 2_000_000_000 ||
    !Number.isSafeInteger(seconds) || Number(seconds) < 1 || Number(seconds) > 31_536_000) {
    throw new AriveTransportError('QUOTA_UNCONFIRMED', 'Enter the provider-confirmed request allowance and its window in seconds.');
  }
  return { limit: Number(limit), seconds: Number(seconds), allowance: Math.floor(Number(limit) * 0.8) };
}
export function validateAriveOperatorBudget(limit: unknown) {
  if (!Number.isSafeInteger(limit) || Number(limit) < 10 || Number(limit) > 600) {
    throw new AriveTransportError('INVALID_OPERATOR_BUDGET', 'Choose an operator request ceiling from 10 to 600 requests per minute.');
  }
  return { limit: Number(limit), seconds: 60, allowance: Number(limit) };
}
export function assertAriveTransportReady(runtime: AriveRuntime | null, keyFingerprint: string, now: Date) {
  if (!runtime?.enabled) throw new AriveTransportError('DISABLED', 'Shared Arive request controls are not enabled.');
  const source = runtime.allowanceSource ?? 'PROVIDER_CONFIRMED';
  if (source === 'OPERATOR_AUTHORIZED') {
    if (!runtime.operatorAuthorizedAt || !Number.isFinite(runtime.operatorAuthorizedAt.getTime()) || runtime.operatorAuthorizedAt > now
      || !runtime.operatorAuthorizedById || !/^[a-zA-Z0-9-]{1,100}$/.test(runtime.operatorAuthorizedById) || runtime.quotaKeyFingerprint !== keyFingerprint) {
      throw new AriveTransportError('OPERATOR_BUDGET_UNAUTHORIZED', 'Authorize an operator request ceiling for the current API key before collecting pipeline data.');
    }
    return validateAriveOperatorBudget(runtime.operatorRequestLimit);
  }
  if (source !== 'PROVIDER_CONFIRMED' || !runtime.quotaConfirmedAt || !Number.isFinite(runtime.quotaConfirmedAt.getTime()) || runtime.quotaConfirmedAt > now || runtime.quotaKeyFingerprint !== keyFingerprint) {
    throw new AriveTransportError('QUOTA_UNCONFIRMED', 'Confirm the Arive request allowance for the current API key before enabling broader synchronization.');
  }
  return validateAriveProviderAllowance(runtime.providerRequestLimit, runtime.providerWindowSeconds);
}

/** Retry-After is seconds or an HTTP date; supported reset conventions are delay / X epoch. */
export function ariveResponseCooldown(headers: Headers, now: Date): Date {
  const candidates: number[] = [];
  const retry = headers.get('retry-after')?.trim();
  if (retry) {
    const value = /^\d+(?:\.\d+)?$/.test(retry) ? now.getTime() + Number(retry) * 1000 : Date.parse(retry);
    if (Number.isFinite(value) && value >= now.getTime() && value <= 8.64e15) candidates.push(value);
  }
  const standard = headers.get('ratelimit-reset')?.trim();
  if (standard && /^\d+(?:\.\d+)?$/.test(standard)) candidates.push(now.getTime() + Number(standard) * 1000);
  const vendor = headers.get('x-ratelimit-reset')?.trim();
  if (vendor && /^\d+(?:\.\d+)?$/.test(vendor)) candidates.push(Number(vendor) * 1000);
  const valid = candidates.filter(value => Number.isFinite(value) && value >= now.getTime() && value <= 8.64e15);
  return new Date(valid.length ? Math.max(...valid) : now.getTime() + 60_000);
}

export type AriveTransportOptions = {
  store: AriveTransportStore;
  credentials: () => Promise<TransportCredentials>;
  encryptionSecret: string;
  encrypt: (token: string) => string;
  decrypt: (ciphertext: string) => string;
  parseJson: (response: Response, operation?: string, validationSecrets?: readonly string[]) => ReturnType<Response['json']>;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  freshAuthentication?: boolean;
  readOnly?: boolean;
};

export async function createAriveTransportSession(options: AriveTransportOptions) {
  const clock = options.now ?? (() => new Date());
  const fetcher = options.fetch ?? fetch;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const fingerprint = (c: TransportCredentials, kind: 'key' | 'credentials') => ariveTransportFingerprint(c, options.encryptionSecret, kind);

  async function request<T>(c: TransportCredentials, kind: string, run: (recordStatus: (response: Response) => Promise<void>) => Promise<T>): Promise<T> {
    const key = fingerprint(c, 'key');
    const id = randomUUID();
    const reserve = () => options.store.transaction(async tx => {
      const now = clock(); const runtime = await tx.runtime();
      const quota = assertAriveTransportReady(runtime, key, now);
      if (runtime!.cooldownUntil && runtime!.cooldownUntil > now) throw new AriveTransportError('COOLDOWN', 'Arive requests are paused until the provider cooldown ends.', runtime!.cooldownUntil);
      if (await tx.activeRequests(now) >= 2) throw new AriveTransportError('BUSY', 'Two Arive requests are already running. Please retry shortly.', new Date(now.getTime() + 1000));
      const recent = await tx.recentRequests(key, new Date(now.getTime() - quota.seconds * 1000));
      if (recent.count >= quota.allowance) throw new AriveTransportError('BUDGET_EXHAUSTED', 'The reserved Arive request allowance has been reached. Please retry after the window resets.', new Date((recent.oldest?.getTime() ?? now.getTime()) + quota.seconds * 1000 + 1));
      await tx.createRequest({ id, connectionId: 'company', keyFingerprint: key, kind, startedAt: now, leaseUntil: new Date(now.getTime() + REQUEST_LEASE_MS), finishedAt: null, statusCode: null });
      return { source: runtime!.allowanceSource, operatorLimit: runtime!.operatorRequestLimit, authorizedAt: runtime!.operatorAuthorizedAt?.getTime() ?? null };
    });
    const waitStarted = clock().getTime();
    const reserveWhenAvailable = async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await reserve(); }
        catch (error) {
          // Wait only for an unreserved slot. Nothing was sent or charged, so
          // this never retries a write or bypasses cooldown/key/budget checks.
          const elapsed = clock().getTime() - waitStarted;
          if (!(error instanceof AriveTransportError) || error.code !== 'BUSY' || elapsed >= 5000 || attempt >= 12) throw error;
          await sleep(Math.min(400, Math.max(1, 5000 - elapsed)));
        }
      }
    };
    const authorization = await reserveWhenAvailable();
    let status: number | null = null;
    try {
      return await run(async response => {
        status = response.status;
        if (response.status === 429) {
          const retryAt = await options.store.transaction(async tx => {
            const runtime = await tx.runtime(); const now = clock(); const until = ariveResponseCooldown(response.headers, now);
            // A response from an old key must not pause or reconfigure its replacement.
            if (!runtime || runtime.quotaKeyFingerprint !== key) return until;
            const patch: Partial<AriveRuntime> = {};
            if (!runtime.cooldownUntil || runtime.cooldownUntil < until) patch.cooldownUntil = until;
            // Back off once per cooldown episode, without overwriting a newer
            // operator authorization or halving twice for concurrent 429 responses.
            if (runtime.allowanceSource === 'OPERATOR_AUTHORIZED' && authorization.source === 'OPERATOR_AUTHORIZED'
              && runtime.operatorAuthorizedAt?.getTime() === authorization.authorizedAt
              && runtime.operatorRequestLimit === authorization.operatorLimit
              && (!runtime.cooldownUntil || runtime.cooldownUntil <= now)
              && Number.isSafeInteger(runtime.operatorRequestLimit)) {
              patch.operatorRequestLimit = Math.max(10, Math.floor(runtime.operatorRequestLimit! / 2));
            }
            if (Object.keys(patch).length) await tx.updateRuntime(patch);
            return runtime.cooldownUntil && runtime.cooldownUntil > until ? runtime.cooldownUntil : until;
          });
          await response.body?.cancel().catch(() => { /* The status and shared cooldown are already recorded. */ });
          // Keep provider throttling typed before a client's generic HTTP parser
          // can mistake it for an identity/matching failure or a failed loan read.
          throw new AriveTransportError('COOLDOWN', 'Arive requests are paused until the provider cooldown ends.', retryAt);
        }
      });
    } finally {
      await options.store.finishRequest(id, clock(), status);
    }
  }

  async function authenticate(c: TransportCredentials) {
    return request(c, 'AUTH', async status => {
      const response = await fetcher(`${BASE}/auth/access-token`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey }, body: JSON.stringify(c), cache: 'no-store', signal: AbortSignal.timeout(20_000), redirect: 'error' });
      await status(response);
      const auth = await options.parseJson(response, 'authentication');
      if (typeof auth.AccessToken !== 'string' || !auth.AccessToken || auth.AccessToken.length > 32768 ||
        !Number.isFinite(auth.ExpiresIn) || auth.ExpiresIn <= 60 || auth.ExpiresIn > 86400) {
        throw new AriveTransportError('INVALID_TOKEN', 'Arive did not issue a token with a valid expiration.');
      }
      return { token: auth.AccessToken as string, expiresAt: new Date(clock().getTime() + auth.ExpiresIn * 1000) };
    });
  }

  async function token(c: TransportCredentials): Promise<string> {
    if (options.freshAuthentication) return (await authenticate(c)).token;
    const credentialFingerprint = fingerprint(c, 'credentials');
    const waitStarted = clock().getTime();
    for (;;) {
      const lease = randomUUID();
      const decision = await options.store.transaction(async tx => {
        const now = clock(); const runtime = await tx.runtime();
        assertAriveTransportReady(runtime, fingerprint(c, 'key'), now);
        if (runtime!.credentialFingerprint !== credentialFingerprint) {
          await tx.updateRuntime({ credentialFingerprint, encryptedAccessToken: null, accessTokenExpiresAt: null, refreshLeaseToken: null, refreshLeaseUntil: null });
        } else {
          if (runtime!.encryptedAccessToken && runtime!.accessTokenExpiresAt && runtime!.accessTokenExpiresAt.getTime() > now.getTime() + TOKEN_SKEW_MS) {
            try { const cached = options.decrypt(runtime!.encryptedAccessToken); if (cached) return { token: cached }; } catch { /* Refresh an unreadable encrypted cache. */ }
          }
          if (runtime!.refreshLeaseToken && runtime!.refreshLeaseUntil && runtime!.refreshLeaseUntil > now) return { wait: true };
        }
        await tx.updateRuntime({ credentialFingerprint, refreshLeaseToken: lease, refreshLeaseUntil: new Date(now.getTime() + TOKEN_LEASE_MS) });
        return { refresh: true };
      });
      if (decision.token) return decision.token;
      if (decision.wait) {
        if (clock().getTime() - waitStarted >= 22_000) throw new AriveTransportError('TOKEN_REFRESH_BUSY', 'Another request is refreshing the Arive connection. Please retry shortly.');
        await sleep(400); continue;
      }
      try {
        const result = await authenticate(c);
        if (fingerprint(await options.credentials(), 'credentials') !== credentialFingerprint) throw new AriveTransportError('CREDENTIALS_CHANGED', 'Arive credentials changed during authentication. Please retry.');
        const committed = await options.store.transaction(async tx => {
          const runtime = await tx.runtime();
          if (!runtime?.enabled || runtime.credentialFingerprint !== credentialFingerprint || runtime.refreshLeaseToken !== lease || !runtime.refreshLeaseUntil || runtime.refreshLeaseUntil <= clock()) return false;
          await tx.updateRuntime({ encryptedAccessToken: options.encrypt(result.token), accessTokenExpiresAt: result.expiresAt, refreshLeaseToken: null, refreshLeaseUntil: null });
          return true;
        });
        if (!committed) throw new AriveTransportError('CREDENTIALS_CHANGED', 'The Arive connection changed during authentication. Please retry.');
        return result.token;
      } finally {
        await options.store.transaction(async tx => {
          const runtime = await tx.runtime();
          if (runtime?.refreshLeaseToken === lease) await tx.updateRuntime({ refreshLeaseToken: null, refreshLeaseUntil: null });
        });
      }
    }
  }

  let initialCredentials = await options.credentials();
  let initialToken = await token(initialCredentials);
  return async (path: string, body?: object, method?: 'PATCH'): ReturnType<Response['json']> => {
    if (!/^\/(?!\/)[^\r\n#]*$/.test(path)) throw new AriveTransportError('INVALID_PATH', 'Invalid Arive request path.');
    if (options.readOnly && (body !== undefined || method !== undefined)) throw new AriveTransportError('READ_ONLY', 'Broader synchronization only reads from Arive.');
    const c = await options.credentials();
    const sameCredentials = fingerprint(c, 'credentials') === fingerprint(initialCredentials, 'credentials');
    let accessToken = options.freshAuthentication && sameCredentials ? initialToken : await token(c);
    initialCredentials = c; initialToken = accessToken;
    const verb = method ?? (body ? 'POST' : 'GET');
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await request(c, attempt ? 'GET_RETRY' : verb, async status => {
        const response = await fetcher(`${BASE}${path}`, { method: verb, headers: { 'Content-Type': 'application/json', 'X-API-KEY': c.apiKey, Authorization: `Bearer ${accessToken}` }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', signal: AbortSignal.timeout(25_000), redirect: 'error' });
        await status(response);
        if (response.status === 401 && verb === 'GET' && attempt === 0) { await response.body?.cancel(); return { retry: true as const }; }
        const data = await options.parseJson(response, path === '/loans/document-classifications' ? 'document classification access check' : 'API request', method === 'PATCH' && /^\/loans\/[a-zA-Z0-9-]{1,100}(?:\?sync=true)?$/.test(path) ? [c.clientId, c.secret, c.apiKey, accessToken] : undefined);
        return { retry: false as const, data };
      });
      if (!result.retry) return result.data;
      if (!options.freshAuthentication) await options.store.transaction(async tx => {
        const runtime = await tx.runtime();
        if (runtime?.credentialFingerprint !== fingerprint(c, 'credentials') || !runtime.encryptedAccessToken) return;
        try { if (options.decrypt(runtime.encryptedAccessToken) !== accessToken) return; } catch { /* Clear the unreadable cache. */ }
        await tx.updateRuntime({ encryptedAccessToken: null, accessTokenExpiresAt: null });
      });
      accessToken = await token(c);
      initialToken = accessToken;
    }
    throw new AriveTransportError('UNAUTHORIZED', 'Arive did not accept the refreshed access token.');
  };
}
