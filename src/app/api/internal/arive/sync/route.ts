import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDueArivePipelineSyncs } from '@/lib/arivePipelineSync';

export const maxDuration = 240;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get('authorization') || '';
  const expected = secret ? `Bearer ${secret}` : '';
  if (!expected || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  // Preview deployments share neither ownership nor permission to run the production scheduler.
  if (process.env.VERCEL_ENV !== 'production') return NextResponse.json({ success: true, skipped: 'Production schedule only' });
  try {
    // Each worker only claims its own records. A rollout failure must not stop
    // the accepted test-file worker while the new infrastructure is disabled.
    const results = await Promise.all([
      runDueArivePipelineSyncs(),
      process.env.ARIVE_ROLLOUT_ENABLED === 'true'
        ? import('@/lib/ariveRolloutWorker').then(worker => worker.runDueAriveRolloutSyncs())
        : Promise.resolve({ checked: 0, succeeded: 0, failed: 0 }),
    ]);
    const result = results.reduce((sum, value) => ({ checked: sum.checked + value.checked, succeeded: sum.succeeded + value.succeeded, failed: sum.failed + value.failed }), { checked: 0, succeeded: 0, failed: 0 });
    return NextResponse.json({ success: result.failed === 0, ...result }, { status: result.failed ? 503 : 200 });
  } catch {
    return NextResponse.json({ success: false, error: 'Arive sync could not run. Review the pilot sync status.' }, { status: 503 });
  }
}
