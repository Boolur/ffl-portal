import { NextResponse } from 'next/server';
import {
  captureHeaders,
  markFailed,
  markProcessed,
  markSkipped,
  recordInbound,
} from '@/lib/webhookInbox';
import { ingestLeadMailboxWebhook } from '@/lib/webhookIngest';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vendorSlug: string }> }
) {
  const { vendorSlug } = await params;

  // Read the request body as text first so we can capture the exact
  // bytes that arrived — even if JSON parsing fails. The inbox row is
  // the source of truth for everything that follows.
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

  // Capture the raw event BEFORE any vendor lookup or processing. If
  // this insert fails the database is unreachable — we respond 503 so
  // Lead Mailbox's retry logic kicks in instead of the payload being
  // silently dropped.
  const inboxEventId = await recordInbound({
    source: 'lead-mailbox',
    vendorSlug,
    headers,
    body: payload ?? { _raw: bodyText, _parseError: true, error: parseError },
  });

  if (!inboxEventId) {
    return NextResponse.json(
      {
        error: 'Service temporarily unavailable — please retry',
        source: 'lead-mailbox-bridge',
      },
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
    const result = await ingestLeadMailboxWebhook({
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
    // Any exception past the inbox write is an in-portal processing
    // failure. The raw payload is already persisted — admins can replay
    // from Lead Distribution → Webhook Inbox once the root cause is fixed.
    await markFailed(inboxEventId, err);
    console.error(
      '[lead-mailbox-bridge] ingestion failed for inbox event',
      inboxEventId,
      err
    );
    return NextResponse.json(
      {
        error: 'Internal processing error — event captured for replay',
        inboxEventId,
        source: 'lead-mailbox-bridge',
      },
      { status: 500 }
    );
  }
}
