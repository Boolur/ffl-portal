import { NextResponse } from 'next/server';
import { downloadPilotFile } from '@/app/actions/submissionPilotActions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ taskId: string; fileId: string }> }) {
  const { taskId, fileId } = await context.params;
  const preparing = new URL(request.url).searchParams.get('prepare') === '1';
  const result = await downloadPilotFile(taskId, fileId, preparing ? 'attachment' : 'inline');
  if (preparing) return NextResponse.json(result, { status: result.success ? 200 : 403, headers: { 'Cache-Control': 'private, no-store' } });
  if (!result.success) return new Response(result.error, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  const response = NextResponse.redirect(result.data);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
