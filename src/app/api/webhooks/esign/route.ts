import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';
import { processOnboardingESignEvent } from '@/lib/onboardingEsignProcessor';

function validSignature(rawBody: string, signatureHeader: string | null) {
  const secret = process.env.ESIGN_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const supplied = signatureHeader.trim().replace(/^sha256=/i, '');
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get('x-esign-signature'))) {
    return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const providerEventId = String(payload.eventId || payload.id || '').trim();
  const envelopeId = String(payload.envelopeId || '').trim();
  const eventType = String(payload.eventType || payload.status || '').trim();
  if (!providerEventId || !envelopeId || !eventType) {
    return NextResponse.json({ success: false, error: 'Missing event fields' }, { status: 400 });
  }
  try {
    const result = await processOnboardingESignEvent({
      providerEventId,
      envelopeId,
      eventType,
      payload,
    });
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result, { status: result.unmatched ? 202 : 200 });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'E-sign event processing failed',
      },
      { status: 502 },
    );
  }
}
