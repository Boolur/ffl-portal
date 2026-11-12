import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const maxDuration = 240;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get('authorization') || '';
  const expected = secret ? `Bearer ${secret}` : '';
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.VERCEL_ENV !== 'production' || process.env.ARIVE_ROLLOUT_ENABLED !== 'true') {
    return NextResponse.json({ success: true, skipped: 'Rollout enrollment is disabled' });
  }
  try {
    const { enrollAriveRolloutBatch } = await import('@/lib/ariveRollout');
    return NextResponse.json({ success: true, ...await enrollAriveRolloutBatch() });
  } catch {
    return NextResponse.json({ success: false, error: 'Enrollment could not run. Review the integration controls.' }, { status: 503 });
  }
}
