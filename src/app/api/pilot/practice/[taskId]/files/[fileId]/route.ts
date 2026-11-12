import { getPracticeFileAccess } from '@/app/actions/practiceDocumentActions';
import { documentDisposition } from '@/lib/documentDelivery';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request, context: { params: Promise<{ taskId: string; fileId: string }> }) {
  const { taskId, fileId } = await context.params;
  const access = await getPracticeFileAccess(taskId, fileId);
  if (!access.success) return Response.json({ success: false, error: access.error }, { status: 403, headers: privateHeaders });
  const params = new URL(request.url).searchParams;
  if (params.get('prepare') === '1') return Response.json({ success: true, data: { name: access.data.name, type: access.data.type, size: access.data.size } }, { headers: privateHeaders });
  try {
    const range = request.headers.get('Range');
    const upstream = await fetch(access.data.url, { cache: 'no-store', redirect: 'error', headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(30000) });
    const type = upstream.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
    if (![200, 206].includes(upstream.status) || !upstream.body || (type && type !== access.data.type && type !== 'application/octet-stream')) {
      await upstream.body?.cancel();
      return Response.json({ success: false, error: 'Unable to load this practice document.' }, { status: 502, headers: privateHeaders });
    }
    const headers = new Headers(privateHeaders);
    headers.set('Content-Type', access.data.type);
    headers.set('Content-Disposition', documentDisposition(access.data.name, params.get('download') === '1'));
    for (const key of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
      const value = upstream.headers.get(key); if (value) headers.set(key, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch { return Response.json({ success: false, error: 'Unable to load this practice document. Please try again.' }, { status: 502, headers: privateHeaders }); }
}
