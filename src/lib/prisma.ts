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
    if (!params.has('connection_limit')) {
      params.set('connection_limit', '20');
    }
    if (!params.has('pool_timeout')) {
      params.set('pool_timeout', '30');
    }
    if (!params.has('connect_timeout')) {
      params.set('connect_timeout', '15');
    }

    return url.toString();
  } catch {
    return raw;
  }
}

const DATABASE_URL = resolveDatabaseUrl();

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : ['error', 'warn'],
    datasources: DATABASE_URL
      ? {
          db: { url: DATABASE_URL },
        }
      : undefined,
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
