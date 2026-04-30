import { NextResponse } from 'next/server';
import { runBonzoHealSweepFromCron } from '@/app/actions/leadHealthActions';

/**
 * Vercel cron entry point for the self-healing Bonzo forward sweep.
 *
 * Scheduled in `vercel.json` to run every 5 minutes. Looks for leads
 * that were assigned >10 minutes ago but have no `lastBonzoForward`
 * audit row (and weren't manually pushed via a Bonzo IntegrationService),
 * and replays the forward through `forwardLeadToBonzo(..., 'sweep')`.
 *
 * Auth model matches the other internal cron routes
 * (`/api/internal/services/dispatch-due`,
 * `/api/internal/notifications/drain`): callers must present
 * `CRON_SECRET` (or `NOTIFICATION_OUTBOX_SECRET` as a fallback for
 * environments that already have it provisioned) via either the
 * `Authorization: Bearer <secret>` header that Vercel cron sends by
 * default, or `x-cron-secret` for hand-rolled triggers / cURL probes.
 *
 * Without a configured secret the route returns 401 — fail-closed so
 * a misconfigured deploy never silently leaves the heal loop wide open
 * to anonymous traffic.
 */
function isAuthorized(request: Request): boolean {
  const expected =
    process.env.NOTIFICATION_OUTBOX_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    '';
  if (!expected) return false;

  const authHeader = request.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';
  const headerSecret = request.headers.get('x-cron-secret')?.trim() || '';
  return bearer === expected || headerSecret === expected;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const url = new URL(request.url);
  const batchSize = parsePositiveInt(url.searchParams.get('batchSize'));
  const minMinutesStale = parsePositiveInt(url.searchParams.get('minMinutesStale'));
  const lookbackDays = parsePositiveInt(url.searchParams.get('lookbackDays'));

  try {
    const result = await runBonzoHealSweepFromCron({
      batchSize,
      minMinutesStale,
      lookbackDays,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    // Surface the error to Vercel's cron log so a sudden run-time
    // regression is visible in the cron history without us needing to
    // dig through general server logs.
    console.error('[bonzo-heal] sweep failed:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// Vercel cron defaults to GET, the existing internal routes accept both
// for parity (and so an admin can probe with a browser if they have the
// secret in a query param manager).
export async function GET(request: Request) {
  return POST(request);
}
