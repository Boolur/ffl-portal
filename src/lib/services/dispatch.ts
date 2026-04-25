/**
 * Integration service dispatcher.
 *
 * A single "dispatch" = take one lead + one IntegrationService, evaluate
 * the service's gating flags, render its URL / headers / body templates
 * against the lead context, fire the HTTP call with the right Content-Type
 * for the configured method, and record the outcome in ServiceDispatch.
 *
 * Callers:
 *   - Manual push from the Leads screen           (pushLeadsToService)
 *   - Event triggers wired into leadActions.ts    (runServiceTriggers)
 *   - Scheduled / delayed queue drain             (cron: dispatch-due)
 */

import {
  IntegrationServiceMethod,
  IntegrationServiceTrigger,
  Prisma,
  ServiceDispatchStatus,
  type IntegrationService,
  type IntegrationServiceCredentialField,
} from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { buildBonzoPayload } from '@/lib/bonzoForward';
import { render, renderString, type TemplateContext } from './template';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DispatchOutcome =
  | { ok: true; status: number; info?: string }
  | {
      ok: false;
      skipped: true;
      reason: SkipReason;
      info?: string;
    }
  | {
      ok: false;
      skipped?: false;
      reason: FailReason;
      status?: number;
      statusText?: string;
      info?: string;
    };

export type SkipReason =
  | 'lead_not_found'
  | 'no_assignee'
  | 'no_webhook_url'
  | 'requires_brand_new'
  | 'requires_not_brand_new'
  | 'excluded_by_scope'
  | 'service_disabled'
  | 'missing_credential'
  | 'missing_url';

export type FailReason =
  | 'http_error'
  | 'exception'
  | 'success_string_not_found'
  | 'oauth_failed'
  | 'capture_field_error';

export type DispatchOptions = {
  /**
   * When provided, update this existing ServiceDispatch row instead of
   * creating a new one. Used by the cron drain path where the row was
   * already inserted at schedule time.
   */
  existingDispatchId?: string;
  /**
   * Suppress writing a ServiceDispatch row — used by synthetic "test
   * this service" flows that don't need an audit trail. Defaults to false.
   */
  skipAudit?: boolean;
  /**
   * Override the trigger stored on the dispatch row. Defaults to MANUAL
   * for explicit callers (e.g. the Push to Service button).
   */
  trigger?: IntegrationServiceTrigger;
};

// `ServiceWithCredentialFields` is the shape our actions load — we include
// the per-service credential field definitions so the dispatcher can pull
// the matching values off UserIntegrationCredential without re-querying.
export type ServiceWithCredentialFields = IntegrationService & {
  credentialFields: IntegrationServiceCredentialField[];
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BODY_PREVIEW = 2_000;
const DEFAULT_USER_AGENT = 'FFL-Portal/1.0 (+lead-distribution)';

const CONTENT_TYPE_BY_METHOD: Record<IntegrationServiceMethod, string | null> = {
  GET: null,
  POST_TEXT: 'text/plain; charset=utf-8',
  POST_FORM: 'application/x-www-form-urlencoded',
  POST_JSON: 'application/json',
  POST_XML: 'application/xml',
  POST_XML_TEXT: 'text/xml',
  POST_XML_SOAP: 'text/xml; charset=utf-8',
  PUT_JSON: 'application/json',
};

const HTTP_VERB_BY_METHOD: Record<IntegrationServiceMethod, 'GET' | 'POST' | 'PUT'> = {
  GET: 'GET',
  POST_TEXT: 'POST',
  POST_FORM: 'POST',
  POST_JSON: 'POST',
  POST_XML: 'POST',
  POST_XML_TEXT: 'POST',
  POST_XML_SOAP: 'POST',
  PUT_JSON: 'PUT',
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function dispatchServiceToLead(
  service: ServiceWithCredentialFields,
  leadId: string,
  opts: DispatchOptions = {}
): Promise<DispatchOutcome> {
  const trigger = opts.trigger ?? IntegrationServiceTrigger.MANUAL;
  const auditEnabled = !opts.skipAudit;

  // 1. Load the lead + relationships in one shot.
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      vendor: true,
      campaign: true,
      assignedUser: true,
    },
  });

  if (!lead) {
    const outcome: DispatchOutcome = {
      ok: false,
      skipped: true,
      reason: 'lead_not_found',
    };
    await recordDispatch(service, leadId, trigger, outcome, null, null, opts);
    return outcome;
  }

  if (!service.active) {
    const outcome: DispatchOutcome = {
      ok: false,
      skipped: true,
      reason: 'service_disabled',
    };
    if (auditEnabled) {
      await recordDispatch(service, leadId, trigger, outcome, null, null, opts);
    }
    return outcome;
  }

  // 2. Gating flags.
  const gate = evaluateGate(service, lead, trigger);
  if (gate) {
    if (auditEnabled) {
      await recordDispatch(service, leadId, trigger, gate, null, null, opts);
    }
    return gate;
  }

  // 3. Load per-user credentials for the assigned user, if any.
  const credentials = await loadUserCredentials(
    service.id,
    lead.assignedUserId
  );

  // 4. Build the template context + check required credentials are present.
  const ctx = await buildContext(service, lead, credentials);

  const missingCredential = findMissingCredential(
    service.credentialFields,
    credentials
  );
  if (missingCredential) {
    const outcome: DispatchOutcome = {
      ok: false,
      skipped: true,
      reason: 'missing_credential',
      info: `Assigned LO has no value for "${missingCredential.label}" (${missingCredential.key}).`,
    };
    if (auditEnabled) {
      await recordDispatch(service, leadId, trigger, outcome, null, null, opts);
    }
    return outcome;
  }

  // 5. Render URL.
  const renderedUrl = renderString(service.urlTemplate, ctx).trim();
  if (!renderedUrl) {
    const outcome: DispatchOutcome = {
      ok: false,
      skipped: true,
      reason: 'missing_url',
      info: 'URL template resolved to empty. Check merge fields.',
    };
    if (auditEnabled) {
      await recordDispatch(service, leadId, trigger, outcome, null, null, opts);
    }
    return outcome;
  }

  // 6. Render body + headers.
  const renderedHeaders = parseHeaderTemplate(
    renderString(service.headersTemplate, ctx)
  );
  let renderedBody =
    service.method === IntegrationServiceMethod.GET
      ? null
      : renderString(service.bodyTemplate, ctx);

  // Bonzo safety net: the "Bonzo" preset has always shipped with an empty
  // bodyTemplate by default, which meant services created before the full
  // merge-field template landed (or where the admin simply never pasted a
  // body) would POST {} and Bonzo would reject with `first_name is
  // required`. If we detect an empty body on a bonzo-preset POST, fall
  // back to the canonical payload built by buildBonzoPayload — the exact
  // same mapping the assignment-time Bonzo forwarder uses, so admin +
  // manual pushes stay consistent.
  if (
    service.method !== IntegrationServiceMethod.GET &&
    (service.type === 'bonzo' || service.slug === 'bonzo') &&
    (!renderedBody || !renderedBody.trim())
  ) {
    renderedBody = JSON.stringify(
      buildBonzoPayload({
        ...lead,
        vendor: { name: lead.vendor.name, slug: lead.vendor.slug },
        campaign: lead.campaign
          ? { name: lead.campaign.name, routingTag: lead.campaign.routingTag }
          : null,
        assignedUser: lead.assignedUser
          ? {
              name: lead.assignedUser.name ?? '',
              email: lead.assignedUser.email ?? '',
            }
          : null,
      })
    );
  }

  // 7. OAuth token fetch if the service requires it.
  if (service.requiresOAuth) {
    try {
      const tokenResult = await ensureOAuthToken(service);
      if (tokenResult.ok && tokenResult.token) {
        const hasAuth = Object.keys(renderedHeaders).some(
          (k) => k.toLowerCase() === 'authorization'
        );
        if (!hasAuth) {
          renderedHeaders.Authorization = `Bearer ${tokenResult.token}`;
        }
      } else {
        const outcome: DispatchOutcome = {
          ok: false,
          reason: 'oauth_failed',
          info: tokenResult.error ?? 'Unable to acquire OAuth token',
        };
        if (auditEnabled) {
          await recordDispatch(
            service,
            leadId,
            trigger,
            outcome,
            { url: renderedUrl, method: service.method, headers: renderedHeaders },
            null,
            opts
          );
        }
        return outcome;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const outcome: DispatchOutcome = {
        ok: false,
        reason: 'oauth_failed',
        info: message,
      };
      if (auditEnabled) {
        await recordDispatch(
          service,
          leadId,
          trigger,
          outcome,
          { url: renderedUrl, method: service.method },
          null,
          opts
        );
      }
      return outcome;
    }
  }

  // 8. Fire the HTTP call.
  const requestSnapshot = {
    url: renderedUrl,
    method: service.method,
    headers: redactHeaders(renderedHeaders),
    bodyPreview: renderedBody ? renderedBody.slice(0, MAX_BODY_PREVIEW) : null,
  };

  const startedAt = Date.now();
  let status = 0;
  let statusText = '';
  let responseBody = '';

  try {
    const res = await sendHttp(
      service.method,
      renderedUrl,
      renderedHeaders,
      renderedBody
    );
    status = res.status;
    statusText = res.statusText;
    responseBody = res.body;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const outcome: DispatchOutcome = {
      ok: false,
      reason: 'exception',
      info: message,
    };
    if (auditEnabled) {
      await recordDispatch(
        service,
        leadId,
        trigger,
        outcome,
        requestSnapshot,
        { elapsedMs: Date.now() - startedAt, error: message },
        opts
      );
    }
    await maybeNotifyFailure(service, lead, outcome);
    return outcome;
  }

  const responseSnapshot = {
    status,
    statusText,
    elapsedMs: Date.now() - startedAt,
    bodyPreview: responseBody.slice(0, MAX_BODY_PREVIEW),
  };

  // 9. Success / success-string check.
  const httpOk = status >= 200 && status < 300;
  if (!httpOk) {
    const outcome: DispatchOutcome = {
      ok: false,
      reason: 'http_error',
      status,
      statusText,
      info: responseBody.slice(0, 500) || undefined,
    };
    if (auditEnabled) {
      await recordDispatch(
        service,
        leadId,
        trigger,
        outcome,
        requestSnapshot,
        responseSnapshot,
        opts
      );
    }
    await maybeNotifyFailure(service, lead, outcome);
    return outcome;
  }

  if (
    service.successString &&
    service.successString.trim() &&
    !responseBody.includes(service.successString.trim())
  ) {
    const outcome: DispatchOutcome = {
      ok: false,
      reason: 'success_string_not_found',
      status,
      statusText,
      info: `Expected response to contain: "${service.successString}"`,
    };
    if (auditEnabled) {
      await recordDispatch(
        service,
        leadId,
        trigger,
        outcome,
        requestSnapshot,
        responseSnapshot,
        opts
      );
    }
    await maybeNotifyFailure(service, lead, outcome);
    return outcome;
  }

  // 10. Capture Fields — best-effort; a capture failure doesn't fail the push.
  let captureInfo: string | undefined;
  try {
    const captureCount = await applyCaptureFields(
      service,
      lead.id,
      responseBody
    );
    if (captureCount > 0) captureInfo = `Captured ${captureCount} field(s).`;
  } catch (err) {
    captureInfo = `Capture fields failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  const outcome: DispatchOutcome = {
    ok: true,
    status,
    info: captureInfo,
  };
  if (auditEnabled) {
    await recordDispatch(
      service,
      leadId,
      trigger,
      outcome,
      requestSnapshot,
      responseSnapshot,
      opts
    );
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Batch runner used by manual push + cron drain
// ---------------------------------------------------------------------------

export async function runDispatchBatch(
  service: ServiceWithCredentialFields,
  leadIds: string[],
  opts: DispatchOptions & { concurrency?: number } = {}
): Promise<Array<{ leadId: string; outcome: DispatchOutcome }>> {
  const { concurrency = 5, ...dispatchOpts } = opts;
  const results: Array<{ leadId: string; outcome: DispatchOutcome }> = new Array(
    leadIds.length
  );
  let cursor = 0;

  async function worker() {
    while (cursor < leadIds.length) {
      const i = cursor++;
      const leadId = leadIds[i];
      try {
        const outcome = await dispatchServiceToLead(service, leadId, dispatchOpts);
        results[i] = { leadId, outcome };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[i] = {
          leadId,
          outcome: { ok: false, reason: 'exception', info: message },
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
  rows: Array<{ leadId: string; outcome: DispatchOutcome }>
): BatchSummary {
  const summary: BatchSummary = {
    total: rows.length,
    succeeded: 0,
    skipped: [],
    failed: [],
  };
  for (const { leadId, outcome } of rows) {
    if (outcome.ok) {
      summary.succeeded += 1;
    } else if (outcome.skipped) {
      summary.skipped.push({
        leadId,
        reason: outcome.reason,
        info: outcome.info,
      });
    } else {
      summary.failed.push({
        leadId,
        reason: outcome.reason,
        status: outcome.status,
        statusText: outcome.statusText,
        info: outcome.info,
      });
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Trigger helper (used by leadActions.ts in Phase 2)
// ---------------------------------------------------------------------------

/**
 * Finds every active service whose statusTrigger matches `trigger` and
 * dispatches the lead through it. Respects per-service Day/Delay — delayed
 * services get a PENDING ServiceDispatch row that the cron drain picks up.
 * Immediate services are fired inline with a short timeout and logged.
 */
export async function runServiceTriggers(
  leadId: string,
  trigger: IntegrationServiceTrigger,
  context: { previousStatus?: string; newStatus?: string } = {}
): Promise<void> {
  try {
    const candidates = await prisma.integrationService.findMany({
      where: {
        active: true,
        statusTrigger: trigger,
      },
      include: { credentialFields: true },
    });

    for (const service of candidates) {
      // ON_STATUS_CHANGE services can filter to a specific target status.
      if (
        trigger === IntegrationServiceTrigger.ON_STATUS_CHANGE &&
        service.triggerStatus &&
        service.triggerStatus !== context.newStatus
      ) {
        continue;
      }

      const delayMinutes =
        service.triggerDelayMinutes && service.triggerDelayMinutes > 0
          ? service.triggerDelayMinutes
          : service.triggerDay && service.triggerDay > 0
            ? service.triggerDay * 24 * 60
            : 0;

      if (delayMinutes > 0) {
        const scheduledFor = new Date(Date.now() + delayMinutes * 60_000);
        await prisma.serviceDispatch.create({
          data: {
            serviceId: service.id,
            leadId,
            trigger,
            scheduledFor,
            status: ServiceDispatchStatus.PENDING,
          },
        });
      } else {
        // Fire-and-forget: failures are recorded in the ServiceDispatch row,
        // but we never throw because trigger callers are in the middle of
        // user-facing work (lead assignment, status change).
        void dispatchServiceToLead(service, leadId, { trigger }).catch((err) => {
          console.warn(
            `[services] trigger dispatch failed for ${service.slug} -> lead ${leadId}:`,
            err
          );
        });
      }
    }
  } catch (err) {
    console.warn(
      `[services] runServiceTriggers(${trigger}) for lead ${leadId} failed:`,
      err
    );
  }
}

// ---------------------------------------------------------------------------
// Scheduled queue drain (cron: /api/internal/services/dispatch-due)
// ---------------------------------------------------------------------------

export type DrainDueResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

/**
 * Pick up to `batchSize` PENDING ServiceDispatch rows whose scheduledFor is
 * in the past and run them through the dispatcher. The row is updated in
 * place (existingDispatchId on DispatchOptions) instead of a new row being
 * written, so the audit log is a single truthful history per delayed send.
 */
export async function drainDueDispatches(
  opts: { batchSize?: number; now?: Date } = {}
): Promise<DrainDueResult> {
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 25, 100));
  const now = opts.now ?? new Date();

  const due = await prisma.serviceDispatch.findMany({
    where: {
      status: ServiceDispatchStatus.PENDING,
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: 'asc' },
    take: batchSize,
    include: {
      service: { include: { credentialFields: true } },
    },
  });

  const result: DrainDueResult = {
    processed: due.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of due) {
    if (!row.service || !row.service.active) {
      await prisma.serviceDispatch.update({
        where: { id: row.id },
        data: {
          status: ServiceDispatchStatus.SKIPPED,
          lastError: row.service ? 'service disabled' : 'service missing',
          completedAt: new Date(),
        },
      });
      result.skipped += 1;
      continue;
    }

    try {
      const outcome = await dispatchServiceToLead(row.service, row.leadId, {
        trigger: row.trigger,
        existingDispatchId: row.id,
      });
      if (outcome.ok) result.sent += 1;
      else if (outcome.skipped) result.skipped += 1;
      else result.failed += 1;
    } catch (err) {
      result.failed += 1;
      await prisma.serviceDispatch.update({
        where: { id: row.id },
        data: {
          status: ServiceDispatchStatus.FAILED,
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        },
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Gating
// ---------------------------------------------------------------------------

function evaluateGate(
  service: ServiceWithCredentialFields,
  lead: NonNullable<Awaited<ReturnType<typeof loadLeadForGate>>>,
  trigger: IntegrationServiceTrigger
): DispatchOutcome | null {
  if (
    trigger === IntegrationServiceTrigger.MANUAL &&
    !service.allowManualSend
  ) {
    return {
      ok: false,
      skipped: true,
      reason: 'service_disabled',
      info: 'Service has "Allow Manual Send" turned off.',
    };
  }
  if (service.requiresAssignedUser && !lead.assignedUserId) {
    return { ok: false, skipped: true, reason: 'no_assignee' };
  }
  if (service.requiresBrandNew && lead.status !== 'NEW') {
    return { ok: false, skipped: true, reason: 'requires_brand_new' };
  }
  if (service.requiresNotBrandNew && lead.status === 'NEW') {
    return { ok: false, skipped: true, reason: 'requires_not_brand_new' };
  }

  // User scope
  if (service.userScope === 'SPECIFIC' && service.userIds.length > 0) {
    const matchesUser = lead.assignedUserId
      ? service.userIds.includes(lead.assignedUserId)
      : false;
    const pass = service.excludeSelected ? !matchesUser : matchesUser;
    if (!pass) {
      return {
        ok: false,
        skipped: true,
        reason: 'excluded_by_scope',
        info: 'Assigned LO is outside this service\u2019s user scope.',
      };
    }
  }

  // Campaign scope
  if (service.campaignScope === 'SPECIFIC' && service.campaignIds.length > 0) {
    const matchesCampaign = lead.campaignId
      ? service.campaignIds.includes(lead.campaignId)
      : false;
    const pass = service.excludeSelected ? !matchesCampaign : matchesCampaign;
    if (!pass) {
      return {
        ok: false,
        skipped: true,
        reason: 'excluded_by_scope',
        info: 'Lead campaign is outside this service\u2019s campaign scope.',
      };
    }
  }

  return null;
}

// Keep a private type alias so `evaluateGate` works without shadowing the
// real Lead+includes shape from Prisma.
async function loadLeadForGate(leadId: string) {
  return prisma.lead.findUnique({
    where: { id: leadId },
    include: { vendor: true, campaign: true, assignedUser: true },
  });
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

async function loadUserCredentials(
  serviceId: string,
  userId: string | null
): Promise<Record<string, string>> {
  if (!userId) return {};
  const row = await prisma.userIntegrationCredential.findUnique({
    where: { userId_serviceId: { userId, serviceId } },
    select: { values: true },
  });
  if (!row) return {};
  const raw = row.values as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

function findMissingCredential(
  fields: IntegrationServiceCredentialField[],
  values: Record<string, string>
): IntegrationServiceCredentialField | null {
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.key];
    if (!v || !v.trim()) return f;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template context builder
// ---------------------------------------------------------------------------

async function buildContext(
  service: ServiceWithCredentialFields,
  lead: NonNullable<Awaited<ReturnType<typeof loadLeadForGate>>>,
  credentials: Record<string, string>
): Promise<TemplateContext> {
  // Fold the assigned user's UserLeadQuota bonzoWebhookUrl into the
  // credential map under the well-known key, so legacy templates that
  // reference `{{user.bonzoWebhookUrl}}` keep working during the Bonzo
  // migration window.
  if (lead.assignedUserId && !credentials.bonzoWebhookUrl) {
    try {
      const quota = await prisma.userLeadQuota.findUnique({
        where: { userId: lead.assignedUserId },
        select: { bonzoWebhookUrl: true },
      });
      if (quota?.bonzoWebhookUrl?.trim()) {
        credentials.bonzoWebhookUrl = quota.bonzoWebhookUrl.trim();
      }
    } catch {
      // Swallow — credentials defaulting is best-effort.
    }
  }

  return {
    lead,
    campaign: lead.campaign,
    vendor: lead.vendor,
    user: lead.assignedUser
      ? {
          id: lead.assignedUser.id,
          name: lead.assignedUser.name,
          email: lead.assignedUser.email,
          credentials,
          profile: {},
        }
      : null,
    now: new Date(),
  };
}

// ---------------------------------------------------------------------------
// HTTP sender
// ---------------------------------------------------------------------------

type SendResult = { status: number; statusText: string; body: string };

async function sendHttp(
  method: IntegrationServiceMethod,
  url: string,
  headers: Record<string, string>,
  body: string | null
): Promise<SendResult> {
  const verb = HTTP_VERB_BY_METHOD[method];
  const finalHeaders: Record<string, string> = { ...headers };
  if (!Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'user-agent')) {
    finalHeaders['User-Agent'] = DEFAULT_USER_AGENT;
  }
  const ct = CONTENT_TYPE_BY_METHOD[method];
  if (ct && !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'content-type')) {
    finalHeaders['Content-Type'] = ct;
  }

  // SOAP usually wants SOAPAction — admins can still add one via the
  // headers template, but we set a sane default of "" so strict servers
  // don't 415 us.
  if (
    method === IntegrationServiceMethod.POST_XML_SOAP &&
    !Object.keys(finalHeaders).some((k) => k.toLowerCase() === 'soapaction')
  ) {
    finalHeaders.SOAPAction = '';
  }

  let wireBody: BodyInit | null = null;
  if (body !== null) {
    if (method === IntegrationServiceMethod.POST_FORM) {
      wireBody = formEncode(body);
    } else {
      wireBody = body;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: verb,
      headers: finalHeaders,
      body: verb === 'GET' ? undefined : wireBody,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, statusText: res.statusText, body: text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Accepts either a JSON object string (`{"k":"v","a":"b"}`) or a pre-
 * encoded `k=v&a=b` body and normalizes it to `application/x-www-form-
 * urlencoded`. This lets admins write the form body as human-readable JSON
 * in the editor and still POST it correctly.
 */
function formEncode(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v === null || v === undefined) continue;
          params.append(k, typeof v === 'string' ? v : JSON.stringify(v));
        }
        return params.toString();
      }
    } catch {
      // Fall through to raw.
    }
  }
  return trimmed;
}

function parseHeaderTemplate(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function redactHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const low = k.toLowerCase();
    if (
      low === 'authorization' ||
      low === 'x-webhook-secret' ||
      low === 'x-api-key' ||
      low.includes('token') ||
      low.includes('secret')
    ) {
      out[k] = v ? `[redacted:${v.length}]` : '';
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OAuth (client-credentials grant cached on the service row)
// ---------------------------------------------------------------------------

type OAuthConfig = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  grantType?: string;
  accessToken?: string;
  expiresAt?: string;
};

async function ensureOAuthToken(
  service: ServiceWithCredentialFields
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const cfg = service.oauthConfig as OAuthConfig | null | undefined;
  if (!cfg || !cfg.tokenUrl || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'OAuth config incomplete (tokenUrl/clientId/clientSecret).' };
  }

  const cachedExpiry = cfg.expiresAt ? Date.parse(cfg.expiresAt) : 0;
  if (
    cfg.accessToken &&
    Number.isFinite(cachedExpiry) &&
    cachedExpiry > Date.now() + 30_000
  ) {
    return { ok: true, token: cfg.accessToken };
  }

  const body = new URLSearchParams({
    grant_type: cfg.grantType ?? 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (cfg.scope) body.set('scope', cfg.scope);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `OAuth token endpoint returned ${res.status}: ${text.slice(0, 200)}` };
    }

    const payload = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number }
      | null;
    if (!payload?.access_token) {
      return { ok: false, error: 'OAuth response missing access_token.' };
    }

    const expiresAt = new Date(
      Date.now() + (payload.expires_in ?? 3600) * 1000
    ).toISOString();

    const next: OAuthConfig = {
      ...cfg,
      accessToken: payload.access_token,
      expiresAt,
    };

    await prisma.integrationService.update({
      where: { id: service.id },
      data: { oauthConfig: next as unknown as Prisma.InputJsonValue },
    });

    return { ok: true, token: payload.access_token };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `OAuth token fetch failed: ${message}` };
  }
}

// ---------------------------------------------------------------------------
// Capture Fields
// ---------------------------------------------------------------------------

type CaptureFieldSpec = {
  path: string;
  target: string;
};

/**
 * Allow-list of Lead columns that Capture Fields can write to. Anything
 * else lands in Lead.customData instead, so misconfigured capture fields
 * can never clobber structured columns the portal depends on.
 */
const LEAD_CAPTURE_ALLOWLIST = new Set<string>([
  'firstName',
  'lastName',
  'email',
  'phone',
  'homePhone',
  'workPhone',
  'vendorLeadId',
  'loanAmount',
  'loanPurpose',
  'loanType',
  'loanTerm',
  'loanRate',
  'creditRating',
  'propertyValue',
  'propertyAddress',
  'propertyCity',
  'propertyState',
  'propertyZip',
  'income',
  'employer',
  'jobTitle',
  'source',
]);

async function applyCaptureFields(
  service: ServiceWithCredentialFields,
  leadId: string,
  responseBody: string
): Promise<number> {
  const specs = parseCaptureFields(service.captureFields);
  if (specs.length === 0) return 0;
  if (!responseBody.trim()) return 0;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    return 0;
  }

  const directUpdate: Record<string, string> = {};
  const customDataPatch: Record<string, unknown> = {};
  let captured = 0;

  for (const spec of specs) {
    const value = readJsonPath(parsed, spec.path);
    if (value === undefined) continue;
    if (LEAD_CAPTURE_ALLOWLIST.has(spec.target)) {
      directUpdate[spec.target] =
        typeof value === 'string' ? value : JSON.stringify(value);
    } else {
      customDataPatch[spec.target] = value;
    }
    captured += 1;
  }

  if (captured === 0) return 0;

  if (Object.keys(customDataPatch).length > 0) {
    const existing = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { customData: true },
    });
    const merged = {
      ...((existing?.customData as object | null | undefined) ?? {}),
      ...customDataPatch,
    };
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        ...directUpdate,
        customData: merged as unknown as Prisma.InputJsonValue,
      },
    });
  } else if (Object.keys(directUpdate).length > 0) {
    await prisma.lead.update({
      where: { id: leadId },
      data: directUpdate,
    });
  }

  await prisma.leadNote.create({
    data: {
      leadId,
      authorId: null,
      content: `Captured ${captured} field(s) from ${service.name} response.`,
    },
  });

  return captured;
}

function parseCaptureFields(raw: unknown): CaptureFieldSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CaptureFieldSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { path, target } = entry as Record<string, unknown>;
    if (typeof path === 'string' && typeof target === 'string' && path && target) {
      out.push({ path, target });
    }
  }
  return out;
}

/**
 * Minimal `a.b.c[0].d` path reader. Good enough for the typical
 * integration-response shapes; admins with more complex needs can stage a
 * transformer in a later phase.
 */
function readJsonPath(root: unknown, path: string): unknown {
  const segments = path
    .split('.')
    .flatMap((seg) => {
      const bracket = /\[(\d+)\]/g;
      const parts = seg.split(bracket).filter((s) => s !== '');
      return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
    });

  let cur: unknown = root;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Audit row writer
// ---------------------------------------------------------------------------

function mapOutcomeToStatus(outcome: DispatchOutcome): ServiceDispatchStatus {
  if (outcome.ok) return ServiceDispatchStatus.SENT;
  if (outcome.skipped) return ServiceDispatchStatus.SKIPPED;
  return ServiceDispatchStatus.FAILED;
}

async function recordDispatch(
  service: ServiceWithCredentialFields,
  leadId: string,
  trigger: IntegrationServiceTrigger,
  outcome: DispatchOutcome,
  requestSnapshot: unknown,
  responseSnapshot: unknown,
  opts: DispatchOptions
) {
  const status = mapOutcomeToStatus(outcome);
  const skippedReason =
    !outcome.ok && outcome.skipped ? outcome.reason : null;
  const lastError =
    !outcome.ok && !outcome.skipped
      ? buildErrorLine(outcome)
      : null;

  const data = {
    status,
    attempts: { increment: 1 } as unknown as number,
    skippedReason,
    lastError,
    requestSnapshot:
      (requestSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue | Prisma.NullTypes.DbNull,
    responseSnapshot:
      (responseSnapshot ?? Prisma.DbNull) as Prisma.InputJsonValue | Prisma.NullTypes.DbNull,
    completedAt: new Date(),
  };

  try {
    if (opts.existingDispatchId) {
      await prisma.serviceDispatch.update({
        where: { id: opts.existingDispatchId },
        data,
      });
    } else {
      await prisma.serviceDispatch.create({
        data: {
          serviceId: service.id,
          leadId,
          trigger,
          scheduledFor: new Date(),
          ...data,
          attempts: 1,
        },
      });
    }
  } catch (err) {
    console.warn(
      `[services] Failed to record dispatch row for service ${service.slug} lead ${leadId}:`,
      err
    );
  }
}

function buildErrorLine(
  outcome: Exclude<DispatchOutcome, { ok: true } | { ok: false; skipped: true }>
): string {
  const parts: string[] = [outcome.reason];
  if (outcome.status) parts.push(`HTTP ${outcome.status} ${outcome.statusText ?? ''}`);
  if (outcome.info) parts.push(outcome.info.slice(0, 500));
  return parts.join(' — ');
}

// ---------------------------------------------------------------------------
// Fail notify
// ---------------------------------------------------------------------------

async function maybeNotifyFailure(
  service: ServiceWithCredentialFields,
  lead: NonNullable<Awaited<ReturnType<typeof loadLeadForGate>>>,
  outcome: DispatchOutcome
) {
  if (outcome.ok) return;
  if (outcome.skipped) return;
  if (!service.failNotifyEmail || !service.failNotifyEmail.trim()) return;

  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)';
  const subject = `[FFL Portal] ${service.name} push failed for lead ${leadName}`;
  const info = outcome.info?.slice(0, 2_000) ?? '';
  const text = [
    `Service: ${service.name} (${service.slug})`,
    `Lead: ${leadName} — id=${lead.id}`,
    `Assigned LO: ${lead.assignedUser?.name ?? '(unassigned)'}`,
    `Reason: ${outcome.reason}`,
    outcome.status ? `HTTP: ${outcome.status} ${outcome.statusText ?? ''}` : null,
    info ? `Details:\n${info}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await sendEmail({
      to: service.failNotifyEmail.trim(),
      subject,
      text,
    });
  } catch (err) {
    console.warn(
      `[services] Failed to send fail-notify email for ${service.slug}:`,
      err
    );
  }
}
