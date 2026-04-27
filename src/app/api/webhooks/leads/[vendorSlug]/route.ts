import { NextResponse } from 'next/server';
import {
  captureHeaders,
  markFailed,
  markProcessed,
  markSkipped,
  recordInbound,
} from '@/lib/webhookInbox';
import { ingestVendorLeadWebhook } from '@/lib/webhookIngest';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vendorSlug: string }> }
) {
  const { vendorSlug } = await params;

  const bodyText = await request.text();

  let payload: Record<string, unknown> | null = null;
  let parseError: string | null = null;
  try {
    payload = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch (err) {
    parseError =
      err instanceof Error ? err.message : 'Unknown JSON parse error';
  }

  const headers = captureHeaders(request.headers);

  const inboxEventId = await recordInbound({
    source: 'leads',
    vendorSlug,
    headers,
    body: payload ?? { _raw: bodyText, _parseError: true, error: parseError },
  });

  if (!inboxEventId) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable — please retry' },
      { status: 503 }
    );
  }

  if (payload === null) {
    await markSkipped(inboxEventId, `Invalid JSON body: ${parseError ?? ''}`);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const signatureHeader =
    request.headers.get('x-webhook-secret') ||
    request.headers.get('authorization');

  try {
    const result = await ingestVendorLeadWebhook({
      vendorSlug,
      payload,
      signatureHeader,
    });

    if (result.status === 'processed') {
      await markProcessed(inboxEventId, result.leadId);
    } else {
      await markSkipped(
        inboxEventId,
        result.skipReason ?? 'Skipped',
        result.leadId
      );
    }

    return NextResponse.json(result.body, { status: result.code });
  } catch (err) {
    await markFailed(inboxEventId, err);
    console.error(
      '[lead-webhook] ingestion failed for inbox event',
      inboxEventId,
      err
    );
    return NextResponse.json(
      {
        error: 'Internal processing error — event captured for replay',
        inboxEventId,
      },
      { status: 500 }
    );
  }
}
