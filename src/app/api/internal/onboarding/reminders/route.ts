import { NextResponse } from 'next/server';
import { enqueueOverdueOnboardingReminders } from '@/app/actions/onboardingActions';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const authorization = request.headers.get('authorization') || '';
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  return bearer === secret || request.headers.get('x-cron-secret')?.trim() === secret;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = await enqueueOverdueOnboardingReminders(process.env.CRON_SECRET?.trim());
  return NextResponse.json({ success: true, ...result });
}

export const POST = GET;
