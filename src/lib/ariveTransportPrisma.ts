import 'server-only';
import { prisma } from '@/lib/prisma';
import { decryptAriveCredentials, encryptAriveCredentials } from '@/lib/ariveCrypto';
import {
  AriveTransportError, ariveTransportFingerprint, assertAriveTransportReady, createAriveTransportSession,
  validateAriveProviderAllowance, type AriveTransportOptions, type AriveTransportStore, type TransportCredentials,
} from './ariveTransport';

const CONNECTION = 'company';
// Keep the largest configurable rolling window so changing the allowance cannot
// erase previously consumed requests. Each reservation removes only a small batch.
const REQUEST_RETENTION_MS = 31_536_000_000;
const REQUEST_CLEANUP_BATCH = 1000;
type Database = typeof prisma;
export function sharedAriveTransportEnabled() { return process.env.ARIVE_SHARED_TRANSPORT_ENABLED === 'true'; }

export function createPrismaAriveTransportStore(db: Database = prisma): AriveTransportStore {
  return {
    transaction: work => db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-transport:${CONNECTION}`}))`;
      return work({
        runtime: () => tx.ariveConnectionRuntime.findUnique({ where: { id: CONNECTION } }),
        updateRuntime: async patch => { await tx.ariveConnectionRuntime.update({ where: { id: CONNECTION }, data: patch }); },
        recentRequests: async (key, since) => {
          const result = await tx.ariveTransportRequest.aggregate({ where: { connectionId: CONNECTION, keyFingerprint: key, startedAt: { gt: since } }, _count: { _all: true }, _min: { startedAt: true } });
          return { count: result._count._all, oldest: result._min.startedAt };
        },
        activeRequests: now => tx.ariveTransportRequest.count({ where: { connectionId: CONNECTION, finishedAt: null, leaseUntil: { gt: now } } }),
        createRequest: async request => {
          const cutoff = new Date(request.startedAt.getTime() - REQUEST_RETENTION_MS);
          const expired = await tx.ariveTransportRequest.findMany({ where: { connectionId: CONNECTION, startedAt: { lt: cutoff }, leaseUntil: { lt: request.startedAt } }, select: { id: true }, orderBy: { startedAt: 'asc' }, take: REQUEST_CLEANUP_BATCH });
          if (expired.length) await tx.ariveTransportRequest.deleteMany({ where: { connectionId: CONNECTION, id: { in: expired.map(item => item.id) }, startedAt: { lt: cutoff }, leaseUntil: { lt: request.startedAt } } });
          await tx.ariveTransportRequest.create({ data: request });
        },
        finishRequest: async (id, finishedAt, statusCode) => { await tx.ariveTransportRequest.updateMany({ where: { id, connectionId: CONNECTION, finishedAt: null }, data: { finishedAt, statusCode } }); },
      });
    }, { maxWait: 5000, timeout: 10000 }),
  };
}

async function savedCredentials(db: Database, encryptionSecret: string): Promise<TransportCredentials> {
  const config = await db.ariveIntegrationConfig.findUnique({ where: { id: CONNECTION }, select: { encryptedCredentials: true } });
  if (!config) throw new AriveTransportError('NO_CREDENTIALS', 'Connect the branch Arive credentials before enabling synchronization.');
  try {
    const value = JSON.parse(decryptAriveCredentials(config.encryptedCredentials, encryptionSecret)) as TransportCredentials;
    if (typeof value.clientId !== 'string' || !value.clientId || typeof value.secret !== 'string' || !value.secret || typeof value.apiKey !== 'string' || !value.apiKey) throw new Error('Invalid credentials');
    return value;
  } catch { throw new AriveTransportError('NO_CREDENTIALS', 'Arive credentials could not be decrypted. Reconnect the branch credentials.'); }
}

/** No network traffic; safe for the broad rollout gate. Never returns tokens or fingerprints. */
export async function isAriveBudgetReady(deps: { db?: Database; now?: () => Date } = {}) {
  if (!sharedAriveTransportEnabled()) return { ready: false, reason: 'Shared Arive request controls have not been activated for this deployment.' };
  const db = deps.db ?? prisma; const now = deps.now?.() ?? new Date();
  try {
    const secret = process.env.NEXTAUTH_SECRET ?? '';
    const c = await savedCredentials(db, secret);
    const runtime = await db.ariveConnectionRuntime.findUnique({ where: { id: CONNECTION } });
    assertAriveTransportReady(runtime, ariveTransportFingerprint(c, secret, 'key'), now);
    if (runtime?.cooldownUntil && runtime.cooldownUntil > now) return { ready: false, reason: 'Arive requests are paused until the provider cooldown ends.' };
    return { ready: true, reason: null };
  } catch (error) { return { ready: false, reason: error instanceof AriveTransportError ? error.message : 'Arive request controls are unavailable.' }; }
}

/** Caller must enforce Admin III. Contains counts and deadlines, never token/key metadata. */
export async function getAriveTransportMetrics(deps: { db?: Database; now?: () => Date } = {}) {
  const db = deps.db ?? prisma; const now = deps.now?.() ?? new Date();
  const empty = { checkedAt: now.toISOString(), deploymentActive: sharedAriveTransportEnabled(), enabled: false, ready: false,
    reason: null as string | null, providerRequestLimit: null as number | null, windowSeconds: null as number | null,
    allowance: null as number | null, used: null as number | null, remaining: null as number | null,
    activeRequests: null as number | null, cooldownUntil: null as string | null, nextAvailableAt: null as string | null };
  if (!empty.deploymentActive) return { ...empty, reason: 'Shared Arive request controls have not been activated for this deployment.' };
  try {
    const secret = process.env.NEXTAUTH_SECRET ?? ''; const c = await savedCredentials(db, secret);
    const key = ariveTransportFingerprint(c, secret, 'key');
    return await createPrismaAriveTransportStore(db).transaction(async tx => {
      const runtime = await tx.runtime();
      const base = { ...empty, enabled: runtime?.enabled ?? false, cooldownUntil: runtime?.cooldownUntil?.toISOString() ?? null };
      let quota: ReturnType<typeof assertAriveTransportReady>;
      try { quota = assertAriveTransportReady(runtime, key, now); }
      catch (error) { return { ...base, reason: error instanceof AriveTransportError ? error.message : 'Arive request controls are unavailable.' }; }
      const recent = await tx.recentRequests(key, new Date(now.getTime() - quota.seconds * 1000));
      const activeRequests = await tx.activeRequests(now);
      const cooldown = runtime!.cooldownUntil && runtime!.cooldownUntil > now ? runtime!.cooldownUntil.getTime() : 0;
      const reset = recent.count >= quota.allowance ? (recent.oldest?.getTime() ?? now.getTime()) + quota.seconds * 1000 + 1 : 0;
      const busy = activeRequests >= 2 ? now.getTime() + 1000 : 0;
      const next = Math.max(cooldown, reset, busy);
      return { ...base, providerRequestLimit: quota.limit, windowSeconds: quota.seconds, allowance: quota.allowance,
        used: recent.count, remaining: Math.max(0, quota.allowance - recent.count), activeRequests,
        ready: !next, reason: cooldown ? 'Arive requests are paused until the provider cooldown ends.' : reset ? 'The reserved Arive request allowance has been reached.' : busy ? 'Two Arive requests are already running.' : null,
        nextAvailableAt: next ? new Date(next).toISOString() : null };
    });
  } catch (error) { return { ...empty, reason: error instanceof AriveTransportError ? error.message : 'Arive request controls are unavailable.' }; }
}

/** Caller must enforce Admin III. Configuration does not make an Arive request. */
export async function configureAriveTransportQuota(input: { providerRequestLimit: number; providerWindowSeconds: number; enabled: boolean }, deps: { db?: Database; now?: () => Date } = {}) {
  if (!input || typeof input.enabled !== 'boolean') throw new AriveTransportError('INVALID_SETTINGS', 'Choose whether shared Arive requests are enabled.');
  const quota = validateAriveProviderAllowance(input.providerRequestLimit, input.providerWindowSeconds);
  const db = deps.db ?? prisma; const now = deps.now?.() ?? new Date(); const secret = process.env.NEXTAUTH_SECRET ?? '';
  const c = await savedCredentials(db, secret); const key = ariveTransportFingerprint(c, secret, 'key');
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-transport:${CONNECTION}`}))`;
    const prior = await tx.ariveConnectionRuntime.findUnique({ where: { id: CONNECTION } });
    const changedKey = prior?.quotaKeyFingerprint !== key;
    const data = { enabled: input.enabled, providerRequestLimit: quota.limit, providerWindowSeconds: quota.seconds, quotaKeyFingerprint: key, quotaConfirmedAt: now,
      ...(changedKey || !input.enabled ? { encryptedAccessToken: null, accessTokenExpiresAt: null, credentialFingerprint: null, refreshLeaseToken: null, refreshLeaseUntil: null } : {}) };
    await tx.ariveConnectionRuntime.upsert({ where: { id: CONNECTION }, create: { id: CONNECTION, ...data }, update: data });
  });
  return { enabled: input.enabled, allowance: quota.allowance, windowSeconds: quota.seconds, deploymentActive: sharedAriveTransportEnabled() };
}

/** Saved calls switch as one connection; explicit-credential tests remain uncached. */
export async function sharedAriveSessionIfEnabled(parseJson: AriveTransportOptions['parseJson'], options: { provided?: TransportCredentials; readOnly?: boolean; required?: boolean } = {}) {
  if (!sharedAriveTransportEnabled()) {
    if (options.required) throw new AriveTransportError('DISABLED', 'Shared Arive request controls have not been activated for this deployment.');
    return null;
  }
  const runtime = await prisma.ariveConnectionRuntime.findUnique({ where: { id: CONNECTION }, select: { enabled: true } });
  if (!runtime?.enabled) {
    throw new AriveTransportError('DISABLED', 'Shared Arive request controls are not enabled.');
  }
  const secret = process.env.NEXTAUTH_SECRET ?? '';
  return createAriveTransportSession({
    store: createPrismaAriveTransportStore(), credentials: options.provided ? async () => options.provided! : () => savedCredentials(prisma, secret),
    encryptionSecret: secret, encrypt: value => encryptAriveCredentials(value, secret), decrypt: value => decryptAriveCredentials(value, secret),
    parseJson, freshAuthentication: Boolean(options.provided), readOnly: options.readOnly,
  });
}
