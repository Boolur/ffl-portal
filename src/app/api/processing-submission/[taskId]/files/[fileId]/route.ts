import { NextResponse } from 'next/server';
import { downloadPilotFile, getPilotFileAccess } from '@/app/actions/submissionPilotActions';
import { documentDisposition } from '@/lib/documentDelivery';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ taskId: string; fileId: string }> }) {
  const { taskId, fileId } = await context.params;
  const params = new URL(request.url).searchParams;
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
  if (params.get('prepare') === '1') {
    const result = await downloadPilotFile(taskId, fileId, 'attachment');
    return NextResponse.json(result, { status: result.success ? 200 : 403, headers });
  }
  const access = await getPilotFileAccess(taskId, fileId);
  if (!access.success) return new Response(access.error, { status: 403, headers });
  try {
    const range = request.headers.get('Range');
    const upstream = await fetch(access.data.url, { cache: 'no-store', headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(30000) });
    if (!upstream.ok) return new Response('Unable to load this document. Please try again.', { status: 502, headers });
    // Stream the authorized file with its original filename, not the storage object ID.
    const responseHeaders = new Headers(headers);
    responseHeaders.set('Content-Type', access.data.type);
    responseHeaders.set('Content-Disposition', documentDisposition(access.data.name, params.get('download') === '1'));
    for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(key);
      if (value) responseHeaders.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response('Unable to load this document. Please try again.', { status: 502, headers });
  }
}
