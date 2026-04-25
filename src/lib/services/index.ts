import { prisma } from '@/lib/prisma';
import { buildBonzoPayload, postBonzoPayload } from '@/lib/bonzoForward';

/**
 * Per-lead push outcome. Callers translate these into UI summaries so the
 * admin can see exactly which leads succeeded, which were intentionally
 * skipped (missing assignee, missing webhook URL, etc.), and which actually
 * errored at the HTTP layer.
 */
export type PushResult =
  | { ok: true; status?: number; info?: string }
  | {
      ok: false;
      skipped: true;
      reason: 'no_assignee' | 'no_webhook_url' | 'lead_not_found';
      info?: string;
    }
  | {
      ok: false;
      skipped?: false;
      reason: 'http_error' | 'exception';
      status?: number;
      statusText?: string;
      info?: string;
    };

/**
 * A push handler receives a lead id + the service row's `config` JSON and
 * returns a structured outcome. Lives here (rather than per-feature) so new
 * services can be added by editing one registry.
 */
export type PushHandler = (
  leadId: string,
  config: unknown
) => Promise<PushResult>;

export const serviceHandlers: Record<string, PushHandler> = {
  bonzo: pushToBonzo,
};

/**
 * Pushes a single lead to its assigned LO's Bonzo webhook URL.
 *
 * Rules (mirrored in the UI copy):
 * - Lead must have an `assignedUserId`. If not -> skip (`no_assignee`).
 * - Assigned user must have a non-empty `UserLeadQuota.bonzoWebhookUrl`.
 *   If not -> skip (`no_webhook_url`).
 * - On HTTP 2xx -> ok. On any other HTTP status -> `http_error`.
 * - On network / timeout / unknown exception -> `exception`.
 */
async function pushToBonzo(leadId: string): Promise<PushResult> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        vendor: { select: { name: true, slug: true } },
        campaign: { select: { name: true, routingTag: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { content: true, createdAt: true },
        },
      },
    });

    if (!lead) {
      return { ok: false, skipped: true, reason: 'lead_not_found' };
    }
    if (!lead.assignedUserId || !lead.assignedUser) {
      return { ok: false, skipped: true, reason: 'no_assignee' };
    }

    const quota = await prisma.userLeadQuota.findUnique({
      where: { userId: lead.assignedUserId },
      select: { bonzoWebhookUrl: true },
    });
    const url = quota?.bonzoWebhookUrl?.trim();
    if (!url) {
      return {
        ok: false,
        skipped: true,
        reason: 'no_webhook_url',
        info: `Assigned LO ${lead.assignedUser.name} has no Bonzo webhook URL configured.`,
      };
    }

    const payload = buildBonzoPayload(lead);
    const res = await postBonzoPayload(url, payload);

    if (res.ok) {
      return { ok: true, status: res.status };
    }
    return {
      ok: false,
      reason: 'http_error',
      status: res.status,
      statusText: res.statusText,
      info: res.bodyExcerpt?.slice(0, 200),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'exception', info: message };
  }
}

/**
 * Run a batch of per-lead push handlers with bounded concurrency. Each lead
 * is processed exactly once; results are returned in the same order as the
 * input ids so the UI can pair them with rows directly.
 */
export async function runPushBatch(
  handler: PushHandler,
  leadIds: string[],
  config: unknown,
  concurrency = 5
): Promise<Array<{ leadId: string; result: PushResult }>> {
  const results: Array<{ leadId: string; result: PushResult }> = new Array(
    leadIds.length
  );
  let cursor = 0;

  async function worker() {
    while (cursor < leadIds.length) {
      const i = cursor++;
      const leadId = leadIds[i];
      try {
        const result = await handler(leadId, config);
        results[i] = { leadId, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[i] = {
          leadId,
          result: { ok: false, reason: 'exception', info: message },
        };
      }
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, leadIds.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

export type BatchSummary = {
  total: number;
  succeeded: number;
  skipped: Array<{ leadId: string; reason: string; info?: string }>;
  failed: Array<{
    leadId: string;
    reason: string;
    status?: number;
    statusText?: string;
    info?: string;
  }>;
};

export function summarizeBatch(
  rows: Array<{ leadId: string; result: PushResult }>
): BatchSummary {
  const summary: BatchSummary = {
    total: rows.length,
    succeeded: 0,
    skipped: [],
    failed: [],
  };
  for (const { leadId, result } of rows) {
    if (result.ok) {
      summary.succeeded += 1;
    } else if (result.skipped) {
      summary.skipped.push({
        leadId,
        reason: result.reason,
        info: result.info,
      });
    } else {
      summary.failed.push({
        leadId,
        reason: result.reason,
        status: result.status,
        statusText: result.statusText,
        info: result.info,
      });
    }
  }
  return summary;
}
