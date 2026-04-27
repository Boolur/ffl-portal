import { Prisma, WebhookInboxStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';

// Headers whose values are credentials/identity tokens. We never want
// their raw values sitting in Postgres where anyone with DB access could
// pull them out, so they're replaced with `[redacted]` at capture time.
// Keep this list lowercase — we match after calling toLowerCase() on the
// header name.
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-webhook-secret',
  'x-api-key',
  'proxy-authorization',
]);

/**
 * Collects a serialize-safe, credential-free snapshot of incoming request
 * headers. The Fetch API's `Headers` isn't JSON-stringifiable directly and
 * we want to avoid persisting secrets, so both concerns get handled here.
 */
export function captureHeaders(requestHeaders: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  requestHeaders.forEach((value, key) => {
    const lower = key.toLowerCase();
    out[lower] = REDACTED_HEADERS.has(lower) ? '[redacted]' : value;
  });
  return out;
}

type InboundParams = {
  source: string;
  vendorSlug: string | null;
  method?: string;
  headers: Record<string, string>;
  body: unknown;
};

/**
 * Persist the raw webhook as the first step of the handler. Returns the
 * inbox event id, or `null` if even the capture insert failed (which
 * typically means the database itself is unreachable — caller should
 * return a 5xx so the sender retries).
 */
export async function recordInbound(params: InboundParams): Promise<string | null> {
  try {
    const event = await prisma.webhookInboxEvent.create({
      data: {
        source: params.source,
        vendorSlug: params.vendorSlug,
        method: params.method ?? 'POST',
        headers: params.headers as unknown as Prisma.InputJsonValue,
        body: (params.body ?? null) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return event.id;
  } catch (err) {
    console.error('[webhook-inbox] failed to capture event', err);
    return null;
  }
}

/**
 * Mark an inbox event as successfully processed and link it to the
 * created Lead (if one was created). Swallows errors — a bookkeeping
 * failure must never turn a successful lead ingestion into a 500.
 */
export async function markProcessed(
  eventId: string | null,
  leadId: string | null
): Promise<void> {
  if (!eventId) return;
  try {
    await prisma.webhookInboxEvent.update({
      where: { id: eventId },
      data: {
        status: WebhookInboxStatus.PROCESSED,
        leadId: leadId ?? null,
        processedAt: new Date(),
        errorMessage: null,
        attempts: { increment: 1 },
      },
    });
  } catch (err) {
    console.error('[webhook-inbox] failed to mark processed', eventId, err);
  }
}

/**
 * Intentional no-op outcomes: unknown vendor, bad signature, duplicate
 * rejection. Preserved for audit but not eligible for automatic replay.
 */
export async function markSkipped(
  eventId: string | null,
  reason: string,
  leadId: string | null = null
): Promise<void> {
  if (!eventId) return;
  try {
    await prisma.webhookInboxEvent.update({
      where: { id: eventId },
      data: {
        status: WebhookInboxStatus.SKIPPED,
        errorMessage: reason.slice(0, 1000),
        leadId: leadId ?? null,
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  } catch (err) {
    console.error('[webhook-inbox] failed to mark skipped', eventId, err);
  }
}

/**
 * Processing threw. The event stays FAILED with the error captured so
 * an admin can replay it from the UI once the underlying cause is fixed.
 */
export async function markFailed(
  eventId: string | null,
  error: unknown
): Promise<void> {
  if (!eventId) return;
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);
  try {
    await prisma.webhookInboxEvent.update({
      where: { id: eventId },
      data: {
        status: WebhookInboxStatus.FAILED,
        errorMessage: message.slice(0, 2000),
        processedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  } catch (err) {
    console.error('[webhook-inbox] failed to mark failed', eventId, err);
  }
}
