import { NextResponse } from 'next/server';
import { resetDailyQuotas, resetWeeklyQuotas, resetMonthlyQuotas } from '@/app/actions/leadActions';

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
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get('type') || 'daily';

  switch (type) {
    case 'daily':
      await resetDailyQuotas();
      break;
    case 'weekly':
      await resetWeeklyQuotas();
      break;
    case 'monthly':
      await resetMonthlyQuotas();
      break;
    default:
      return NextResponse.json({ success: false, error: `Unknown reset type: ${type}` }, { status: 400 });
  }

  return NextResponse.json({ success: true, type, resetAt: new Date().toISOString() });
}
