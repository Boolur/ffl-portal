import { NextResponse } from 'next/server';
import { getSubmissionPilot } from '@/app/actions/submissionPilotActions';

export const dynamic = 'force-dynamic';

// Read separately from the mutation queue so file preparation cannot hold up the popup.
export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await context.params;
  const result = await getSubmissionPilot(taskId);
  return NextResponse.json(result, {
    status: result.success ? 200 : 403,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
