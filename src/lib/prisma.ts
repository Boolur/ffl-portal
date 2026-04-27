import { PrismaClient } from '@prisma/client';

// Rewrite DATABASE_URL at boot so every Prisma client in the process
// opens a properly sized client-side connection pool against the
// Supabase pooler (pgbouncer).
//
// Context: Prisma's default `connection_limit` is 5 per client. On
// Vercel serverless, every lambda instance spins up its own Prisma
// client and therefore caps at 5 open connections to pgbouncer. The
// /tasks query eager-loads a lot of relations and was logging
// 10-18s durations in production; the dashboard fires 3 parallel
// queries; a couple of concurrent users instantly saturate the 5
// slots and the next query throws:
//   "Timed out fetching a new connection from the connection pool.
//    (Current connection pool timeout: 10, connection limit: 5)"
// which bubbled up as an opaque "Server Components render" error in
// the browser.
//
// Supabase's pgbouncer in transaction-pooling mode multiplexes many
// client connections onto a smaller set of real Postgres connections,
// so bumping connection_limit client-side is safe and is exactly the
// pattern Supabase recommends for serverless.
function resolveDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const params = url.searchParams;

    if (!params.has('pgbouncer') && url.hostname.includes('pooler.supabase.com')) {
      params.set('pgbouncer', 'true');
    }
    // Force-override pool sizing. The earlier version only set these
    // when absent, which meant if DATABASE_URL already contained
    // `?connection_limit=5` (Prisma's default, baked into the URL in
    // Vercel at some point) our tuning was silently ignored and the
    // production logs kept reporting "connection limit: 5". Always
    // overwrite so every deploy gets the values we actually want.
    params.set('connection_limit', '20');
    params.set('pool_timeout', '30');
    params.set('connect_timeout', '15');
    // Safety valve: kill any single query that tries to run longer
    // than 25s. Without this, a slow tasks.findMany (we've logged 10-
    // 18s p50 and occasional 30s+ outliers) can hold a pool slot the
    // full Postgres-idle-transaction-timeout, starving every other
    // request on the same lambda. 25s is long enough for the fat
    // admin dashboard queries to succeed but short enough to recycle
    // the slot before the 30s pool_timeout other requests are waiting
    // on.
    params.set('statement_timeout', '25000');
    params.set('socket_timeout', '30000');

    return url.toString();
  } catch {
    return raw;
  }
}

function logPrismaBoot(url: string | undefined) {
  if (!url) return;
  // Emit one line on lambda cold start so we can verify in Vercel
  // logs that our pool + timeout params are actually live, without
  // leaking the password or host.
  try {
    const parsed = new URL(url);
    const params = parsed.searchParams;
    console.info('[prisma] boot', {
      host: parsed.hostname,
      pgbouncer: params.get('pgbouncer'),
      connection_limit: params.get('connection_limit'),
      pool_timeout: params.get('pool_timeout'),
      connect_timeout: params.get('connect_timeout'),
      statement_timeout: params.get('statement_timeout'),
      socket_timeout: params.get('socket_timeout'),
    });
  } catch {
    // URL parse already failed upstream; nothing to log.
  }
}

const DATABASE_URL = resolveDatabaseUrl();

const globalForPrisma = global as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  logPrismaBoot(DATABASE_URL);
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error', 'warn'],
    datasources: DATABASE_URL
      ? {
          db: { url: DATABASE_URL },
        }
      : undefined,
  });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
