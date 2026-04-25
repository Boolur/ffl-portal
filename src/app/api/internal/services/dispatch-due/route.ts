import { NextResponse } from 'next/server';
import { drainDueDispatches } from '@/lib/services';

function isAuthorized(request: Request) {
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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }
  const url = new URL(request.url);
  const batchSizeRaw = url.searchParams.get('batchSize');
  const batchSize = batchSizeRaw ? Number(batchSizeRaw) : undefined;

  const result = await drainDueDispatches({
    batchSize: Number.isFinite(batchSize) ? batchSize : undefined,
  });
  return NextResponse.json({ success: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
