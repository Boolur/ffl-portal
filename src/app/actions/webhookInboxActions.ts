'use server';

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma, UserRole, WebhookInboxStatus } from '@prisma/client';
import { isAdmin as isAdminRole } from '@/lib/adminTiers';
import {
  ingestLeadMailboxWebhook,
  ingestVendorLeadWebhook,
} from '@/lib/webhookIngest';
import { markFailed, markProcessed, markSkipped } from '@/lib/webhookInbox';
import { revalidatePath } from 'next/cache';

const AUTO_CLEAR_AFTER_MS = 60 * 60 * 1000;

async function assertDistributionAdmin() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role as UserRole | undefined;
  // Lead Distribution is an Admin II+ / Admin III surface; Admin I doesn't
  // see Lead Distribution and so should not see the inbox either. We reuse
  // isAdminRole + MANAGER for write-level actions to stay consistent with
  // every other lead-distribution gate.
  const allowed = isAdminRole(role) || role === UserRole.MANAGER;
  if (!allowed) throw new Error('Unauthorized');
  return session;
}

function parseCapturedRawJson(body: Record<string, unknown>):
  | Record<string, unknown>
  | null {
  const raw = body._raw;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '');
  const lastBrace = trimmed.lastIndexOf('}');
  if (lastBrace < 0 || !/^[\s`]*$/.test(trimmed.slice(lastBrace + 1))) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(0, lastBrace + 1)) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export type InboxStatusFilter = 'ALL' | WebhookInboxStatus;

export type WebhookInboxListItem = {
  id: string;
  source: string;
  vendorSlug: string | null;
  status: WebhookInboxStatus;
  attempts: number;
  errorMessage: string | null;
  leadId: string | null;
  receivedAt: string;
  processedAt: string | null;
  // A short preview of the payload (first/last name if present, else source).
  // Kept small so the list fetch is cheap — full body is fetched on demand.
  preview: string;
};

export type WebhookInboxCounts = {
  pending: number;
  failed: number;
  processed: number;
  skipped: number;
};

function buildPreview(body: unknown): string {
  if (!body || typeof body !== 'object') return '—';
  const b = body as Record<string, unknown>;
  const first =
    b.FirstName ??
    b.first_name ??
    b.firstName ??
    (b.Contact as Record<string, unknown> | undefined)?.firstName;
  const last =
    b.LastName ??
    b.last_name ??
    b.lastName ??
    (b.Contact as Record<string, unknown> | undefined)?.lastName;
  const email =
    b.Email ?? b.email ?? (b.Contact as Record<string, unknown> | undefined)?.email;
  const name = [first, last].filter(Boolean).join(' ').trim();
  if (name) return email ? `${name} · ${email}` : name;
  if (email) return String(email);
  if (b.routing_tag) return `routing_tag=${String(b.routing_tag)}`;
  return '—';
}

async function autoClearResolvedInboxEvents(): Promise<number> {
  const olderThan = new Date(Date.now() - AUTO_CLEAR_AFTER_MS);
  const result = await prisma.$executeRaw`
    UPDATE "WebhookInboxEvent" stale
    SET
      "status" = ${WebhookInboxStatus.SKIPPED}::"WebhookInboxStatus",
      "errorMessage" = 'auto-cleared: later proof of successful webhook processing exists',
      "processedAt" = COALESCE(stale."processedAt", NOW())
    WHERE stale."status"::text IN (${WebhookInboxStatus.FAILED}, ${WebhookInboxStatus.PENDING})
      AND stale."receivedAt" <= ${olderThan}
      AND (
        (
          stale."leadId" IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "Lead" l WHERE l."id" = stale."leadId"
          )
        )
        OR EXISTS (
          SELECT 1
          FROM "WebhookInboxEvent" processed
          WHERE processed."id" <> stale."id"
            AND processed."status"::text = ${WebhookInboxStatus.PROCESSED}
            AND processed."receivedAt" > stale."receivedAt"
            AND processed."source" = stale."source"
            AND COALESCE(processed."vendorSlug", '') = COALESCE(stale."vendorSlug", '')
            AND processed."body" = stale."body"
            AND processed."leadId" IS NOT NULL
        )
      )
  `;
  return result;
}

export async function getWebhookInboxCounts(): Promise<WebhookInboxCounts> {
  await assertDistributionAdmin();
  await autoClearResolvedInboxEvents();
  // groupBy gives us all four status counts in a single round-trip so the
  // Lead Distribution page load doesn't pay for four separate scans.
  const rows = await prisma.webhookInboxEvent.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const counts: WebhookInboxCounts = {
    pending: 0,
    failed: 0,
    processed: 0,
    skipped: 0,
  };
  for (const row of rows) {
    const key = row.status.toLowerCase() as keyof WebhookInboxCounts;
    counts[key] = row._count._all;
  }
  return counts;
}

export async function listWebhookInboxEvents(params?: {
  status?: InboxStatusFilter;
  take?: number;
  skip?: number;
}): Promise<WebhookInboxListItem[]> {
  await assertDistributionAdmin();
  await autoClearResolvedInboxEvents();
  const take = Math.min(Math.max(params?.take ?? 50, 1), 200);
  const skip = Math.max(params?.skip ?? 0, 0);
  const status = params?.status ?? 'FAILED';

  const where =
    status === 'ALL' ? {} : { status: status as WebhookInboxStatus };

  const rows = await prisma.webhookInboxEvent.findMany({
    where,
    orderBy: { receivedAt: 'desc' },
    take,
    skip,
    select: {
      id: true,
      source: true,
      vendorSlug: true,
      status: true,
      attempts: true,
      errorMessage: true,
      leadId: true,
      receivedAt: true,
      processedAt: true,
      body: true,
    },
  });

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    vendorSlug: r.vendorSlug,
    status: r.status,
    attempts: r.attempts,
    errorMessage: r.errorMessage,
    leadId: r.leadId,
    receivedAt: r.receivedAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    preview: buildPreview(r.body),
  }));
}

export async function getWebhookInboxEventDetail(eventId: string): Promise<{
  id: string;
  source: string;
  vendorSlug: string | null;
  status: WebhookInboxStatus;
  attempts: number;
  errorMessage: string | null;
  leadId: string | null;
  receivedAt: string;
  processedAt: string | null;
  headers: unknown;
  body: unknown;
} | null> {
  await assertDistributionAdmin();
  const row = await prisma.webhookInboxEvent.findUnique({
    where: { id: eventId },
  });
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    vendorSlug: row.vendorSlug,
    status: row.status,
    attempts: row.attempts,
    errorMessage: row.errorMessage,
    leadId: row.leadId,
    receivedAt: row.receivedAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
    headers: row.headers,
    body: row.body,
  };
}

export type ReplayResult = {
  ok: boolean;
  status: WebhookInboxStatus;
  leadId: string | null;
  error: string | null;
};

/**
 * Replay a single inbox event through the same ingestion path the live
 * webhook uses. The signature header is intentionally not re-validated
 * (we can't — we only stored a `[redacted]` marker) so the admin action
 * doubles as the authorization here. A successful replay updates the
 * inbox row to PROCESSED (or SKIPPED) and — for previously FAILED events
 * — clears the errorMessage.
 */
export async function replayInboxEvent(
  eventId: string
): Promise<ReplayResult> {
  await assertDistributionAdmin();
  const row = await prisma.webhookInboxEvent.findUnique({
    where: { id: eventId },
  });
  if (!row) return { ok: false, status: 'FAILED', leadId: null, error: 'Event not found' };

  // Reject replay for events whose body is unparseable JSON. Those were
  // captured verbatim but have no meaningful payload to re-ingest.
  let body = row.body as unknown;
  if (
    !body ||
    typeof body !== 'object' ||
    (body as Record<string, unknown>)._parseError
  ) {
    const recovered =
      body && typeof body === 'object'
        ? parseCapturedRawJson(body as Record<string, unknown>)
        : null;
    if (!recovered) {
      await markSkipped(row.id, 'Replay skipped: body is not valid JSON');
      return {
        ok: false,
        status: WebhookInboxStatus.SKIPPED,
        leadId: null,
        error: 'Body is not valid JSON — cannot replay',
      };
    }
    body = recovered;
    await prisma.webhookInboxEvent.update({
      where: { id: row.id },
      data: { body: recovered as Prisma.InputJsonValue },
    });
  }

  if (!row.vendorSlug) {
    return {
      ok: false,
      status: row.status,
      leadId: null,
      error: 'No vendor slug captured — cannot route replay',
    };
  }

  try {
    const result =
      row.source === 'lead-mailbox'
        ? await ingestLeadMailboxWebhook({
            vendorSlug: row.vendorSlug,
            payload: body as Record<string, unknown>,
            signatureHeader: null,
          })
        : row.source === 'leads'
          ? await ingestVendorLeadWebhook({
              vendorSlug: row.vendorSlug,
              payload: body as Record<string, unknown>,
              signatureHeader: null,
            })
          : null;

    if (!result) {
      return {
        ok: false,
        status: row.status,
        leadId: null,
        error: `Unknown webhook source "${row.source}"`,
      };
    }

    if (result.status === 'processed') {
      await markProcessed(row.id, result.leadId);
      revalidatePath('/admin/leads');
      return {
        ok: true,
        status: WebhookInboxStatus.PROCESSED,
        leadId: result.leadId,
        error: null,
      };
    }

    await markSkipped(
      row.id,
      result.skipReason ?? 'Skipped on replay',
      result.leadId
    );
    return {
      ok: true,
      status: WebhookInboxStatus.SKIPPED,
      leadId: result.leadId,
      error: result.skipReason,
    };
  } catch (err) {
    await markFailed(row.id, err);
    return {
      ok: false,
      status: WebhookInboxStatus.FAILED,
      leadId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sequentially replay every FAILED event. Sequential (not parallel) on
 * purpose: during an outage-recovery scenario we want to pace the load
 * through distribution + service triggers and avoid re-exhausting the
 * connection pool that probably caused the original failure.
 */
export async function replayAllFailedInboxEvents(): Promise<{
  attempted: number;
  processed: number;
  skipped: number;
  failed: number;
}> {
  await assertDistributionAdmin();
  const failed = await prisma.webhookInboxEvent.findMany({
    where: { status: WebhookInboxStatus.FAILED },
    select: { id: true },
    orderBy: { receivedAt: 'asc' },
    take: 500,
  });

  let processed = 0;
  let skipped = 0;
  let stillFailed = 0;

  for (const { id } of failed) {
    const result = await replayInboxEvent(id);
    if (result.status === WebhookInboxStatus.PROCESSED) processed += 1;
    else if (result.status === WebhookInboxStatus.SKIPPED) skipped += 1;
    else stillFailed += 1;
  }

  revalidatePath('/admin/leads');
  return {
    attempted: failed.length,
    processed,
    skipped,
    failed: stillFailed,
  };
}

/**
 * Soft-delete an inbox event. Used to dismiss a FAILED row that has
 * been handled some other way (e.g. manually re-entered) so it stops
 * clogging the "Failed" list.
 */
export async function deleteInboxEvent(eventId: string): Promise<void> {
  await assertDistributionAdmin();
  await prisma.webhookInboxEvent.delete({ where: { id: eventId } });
  revalidatePath('/admin/leads');
}

export async function deleteInboxEventsByStatus(
  statuses: Array<'FAILED' | 'PENDING' | 'SKIPPED'>
): Promise<{ deleted: number }> {
  await assertDistributionAdmin();
  const allowed = new Set<string>([
    WebhookInboxStatus.FAILED,
    WebhookInboxStatus.PENDING,
    WebhookInboxStatus.SKIPPED,
  ]);
  const safeStatuses = statuses.filter((status) =>
    allowed.has(status)
  );
  if (safeStatuses.length === 0) return { deleted: 0 };

  const result = await prisma.webhookInboxEvent.deleteMany({
    where: { status: { in: safeStatuses as WebhookInboxStatus[] } },
  });
  revalidatePath('/admin/leads');
  return { deleted: result.count };
}
