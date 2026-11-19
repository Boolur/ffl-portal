import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runLeadershipPilotCollection } from '@/lib/ariveLeadershipPilotWorker';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get('authorization') ?? '');
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ skipped: true });
  try {
    return NextResponse.json(await runLeadershipPilotCollection({ deadlineMs: Date.now() + 180_000 }));
  } catch {
    return NextResponse.json({ error: 'Pilot collection could not run.' }, { status: 503 });
  }
}
