import { createHash, timingSafeEqual } from 'node:crypto';

export const SHAPE_WEBHOOK_MAX_BYTES = 1024 * 1024;
export type ShapeWebhookCapture = {
  body: Record<string, unknown> | unknown[];
  headers: Record<string, string>;
};

// Capture first. No field names, status transitions or downstream actions are
// assumed until Shape's callback contract has been agreed and tested.
export async function receiveShapeWebhook(
  request: Request,
  persist: (event: ShapeWebhookCapture) => Promise<string>,
  secret = process.env.SHAPE_WEBHOOK_SECRET,
): Promise<Response> {
  const reply = (status: number, body: Record<string, unknown>) =>
    Response.json(body, { status });
  if (!secret || secret.length < 32) {
    return reply(503, { accepted: false, error: 'Webhook not configured' });
  }
  const supplied = request.headers.get('x-webhook-secret') ?? '';
  const hash = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(hash(secret), hash(supplied))) {
    return reply(401, { accepted: false, error: 'Unauthorized' });
  }
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json' && !mediaType?.match(/^application\/[\w.+-]+\+json$/)) {
    return reply(415, { accepted: false, error: 'Expected application/json' });
  }
  if (Number(request.headers.get('content-length')) > SHAPE_WEBHOOK_MAX_BYTES) {
    return reply(413, { accepted: false, error: 'Payload too large' });
  }
  let body: ShapeWebhookCapture['body'];
  try {
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > SHAPE_WEBHOOK_MAX_BYTES) {
            await reader.cancel();
            return reply(413, { accepted: false, error: 'Payload too large' });
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object') throw new Error('Expected object or array');
  } catch {
    return reply(400, { accepted: false, error: 'Invalid JSON object or array' });
  }
  // Only keep useful delivery metadata, never arbitrary credential headers.
  const headers: Record<string, string> = {};
  for (const key of ['content-type', 'user-agent', 'x-request-id', 'x-event-id']) {
    const value = request.headers.get(key);
    if (value) headers[key] = value;
  }
  try {
    const inboxEventId = await persist({ body, headers });
    return reply(202, { accepted: true, inboxEventId, processing: 'awaiting_mapping' });
  } catch {
    // Do not log the body or database exception: either may contain borrower data.
    return reply(503, { accepted: false, error: 'Storage unavailable; retry delivery' });
  }
}
