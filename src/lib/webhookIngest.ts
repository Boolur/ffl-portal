import {
  IntegrationServiceTrigger,
  LeadStatus,
  type Prisma,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { distributeLead } from '@/app/actions/leadActions';
import { runServiceTriggers } from '@/lib/services';
import {
  LEAD_MAILBOX_FIELD_MAP,
  LEAD_MAILBOX_TARGET_FIELDS,
  extractBridgeNotes,
} from '@/lib/leadMailboxBridge';
import { normalizeMilitaryFlag } from '@/lib/militaryFlag';

// Matches an unsubstituted Lead Mailbox placeholder, e.g. "{FirstName}"
// or "{Co_DateOfBirth}". LM passes the literal token through when it
// doesn't recognize a field on the vendor side — those strings must not
// be persisted on real Lead fields.
const UNSUBSTITUTED_PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

function normalizeStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  if (UNSUBSTITUTED_PLACEHOLDER.test(str)) return null;
  return str;
}

/**
 * Shape returned by every ingestion path. `status` and `code` map 1:1 to
 * the HTTP semantics the webhook route responds with; `body` is the JSON
 * we want to echo back to the sender. `leadId` is set whenever a Lead
 * row was actually persisted, and the webhook inbox uses it to link
 * captured events to their resulting Lead. `skipReason` — when present —
 * is passed into `markSkipped` so audit rows explain themselves (unknown
 * vendor, bad signature, duplicate reject, etc.).
 */
export type IngestResult = {
  status: 'processed' | 'skipped';
  code: number;
  body: Record<string, unknown>;
  leadId: string | null;
  skipReason: string | null;
};

export type LeadMailboxIngestInput = {
  vendorSlug: string;
  payload: Record<string, unknown>;
  // Used only for signature validation; replay paths pass `null` which
  // means "trust the captured event, we already saw this come in".
  signatureHeader?: string | null;
};

/**
 * Core ingestion for the Lead Mailbox bridge. Pulled out of the route
 * handler so the raw webhook inbox can replay a stored payload through
 * the exact same code path that ingested it live.
 */
export async function ingestLeadMailboxWebhook(
  input: LeadMailboxIngestInput
): Promise<IngestResult> {
  const { vendorSlug, payload, signatureHeader = null } = input;

  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: vendorSlug },
  });

  if (!vendor || !vendor.active) {
    return {
      status: 'skipped',
      code: 404,
      body: { error: 'Unknown or inactive vendor' },
      leadId: null,
      skipReason: `Unknown or inactive vendor slug "${vendorSlug}"`,
    };
  }

  // Signature check is bypassed on replay (signatureHeader === null by
  // convention). The raw inbox event was captured before we could have
  // validated the signature anyway, and replay is an authenticated admin
  // action.
  if (vendor.webhookSecret && signatureHeader !== null) {
    if (
      signatureHeader !== vendor.webhookSecret &&
      signatureHeader !== `Bearer ${vendor.webhookSecret}`
    ) {
      return {
        status: 'skipped',
        code: 401,
        body: { error: 'Unauthorized' },
        leadId: null,
        skipReason: 'Invalid webhook signature',
      };
    }
  }

  const routingTag = normalizeStringValue(payload.routing_tag);

  let campaign: Awaited<
    ReturnType<typeof prisma.leadCampaign.findUnique>
  > = null;
  if (routingTag) {
    // Archived campaigns must not route new leads — otherwise archiving
    // a campaign is meaningless and un-archiving can resurface partial
    // traffic unexpectedly. Falling through to `null` sends the lead to
    // the Unassigned Pool, which is the correct behavior for "this
    // campaign is paused."
    const match = await prisma.leadCampaign.findUnique({
      where: { vendorId_routingTag: { vendorId: vendor.id, routingTag } },
    });
    if (match?.active) campaign = match;
  }

  const vendorLeadId =
    normalizeStringValue(payload.lead_id) ??
    normalizeStringValue(payload.leadId) ??
    normalizeStringValue(payload.leadid) ??
    normalizeStringValue(payload.id);

  if (campaign?.duplicateHandling === 'REJECT' && vendorLeadId) {
    const existing = await prisma.lead.findFirst({
      where: { vendorId: vendor.id, vendorLeadId },
    });
    if (existing) {
      return {
        status: 'skipped',
        code: 409,
        body: { error: 'Duplicate lead rejected', leadId: existing.id },
        leadId: existing.id,
        skipReason: `Duplicate vendorLeadId=${vendorLeadId} (REJECT policy)`,
      };
    }
  }

  const leadFields: Record<string, string> = {};
  for (const [payloadKey, rawValue] of Object.entries(payload)) {
    const target = LEAD_MAILBOX_FIELD_MAP[payloadKey];
    if (!target) continue;
    if (!LEAD_MAILBOX_TARGET_FIELDS.has(target)) continue;
    const value = normalizeStringValue(rawValue);
    if (value === null) continue;
    if (leadFields[target]) continue;
    if (target === 'isMilitary') {
      const canonical = normalizeMilitaryFlag(value);
      leadFields[target] = canonical ?? value;
      continue;
    }
    leadFields[target] = value;
  }

  // Mirror mailing -> property when property is blank. The field map
  // routes `mailing_*` to `Lead.mailing*` (so investor leads with a
  // distinct subject property preserve both), but historically every
  // downstream consumer (Broker Launch email, CSV export, lead detail
  // UI, generic outbound integrations) only reads `propertyAddress` /
  // `propertyCity` / etc. FreeRateUpdate and LendingTree LMB services
  // often substitute `{phys_*}` to a blank string while reliably
  // populating `{Mail_*}`, so without this mirror those consumers go
  // back to seeing null addresses on the same leads yesterday's fix
  // (commit 3c9b82f) was supposed to repair. The Bonzo forwarder
  // separately falls back `mailingAddress ?? propertyAddress`, so this
  // mirror is purely about keeping the property* columns populated for
  // everything that doesn't.
  const MAILING_TO_PROPERTY: Array<[string, string]> = [
    ['mailingAddress', 'propertyAddress'],
    ['mailingCity', 'propertyCity'],
    ['mailingState', 'propertyState'],
    ['mailingZip', 'propertyZip'],
    ['mailingCounty', 'propertyCounty'],
  ];
  for (const [mail, property] of MAILING_TO_PROPERTY) {
    if (!leadFields[property] && leadFields[mail]) {
      leadFields[property] = leadFields[mail];
    }
  }

  const statusStr = campaign?.defaultLeadStatus ?? 'UNASSIGNED';
  const status = (Object.values(LeadStatus) as string[]).includes(statusStr)
    ? (statusStr as LeadStatus)
    : LeadStatus.UNASSIGNED;

  const createData: Prisma.LeadUncheckedCreateInput = {
    vendorLeadId,
    vendorId: vendor.id,
    campaignId: campaign?.id ?? null,
    status,
    source: `Lead Mailbox (${vendor.name})`,
    rawPayload: payload as Prisma.InputJsonValue,
    receivedAt: new Date(),
  };

  for (const [k, v] of Object.entries(leadFields)) {
    (createData as Record<string, unknown>)[k] = v;
  }

  const lead = await prisma.lead.create({ data: createData });

  void runServiceTriggers(lead.id, IntegrationServiceTrigger.ON_RECEIVE);
  void runServiceTriggers(
    lead.id,
    IntegrationServiceTrigger.DELAY_AFTER_RECEIVE
  );

  const noteContents = extractBridgeNotes(payload);
  if (noteContents.length > 0) {
    try {
      await prisma.leadNote.createMany({
        data: noteContents.map((content) => ({
          leadId: lead.id,
          authorId: null,
          content,
        })),
      });
    } catch (err) {
      console.warn(
        '[lead-mailbox-bridge] failed to persist vendor notes for lead',
        lead.id,
        err
      );
    }
  }

  try {
    await distributeLead(lead.id);
  } catch (err) {
    // Distribution failures are non-fatal from the webhook's point of
    // view — the lead is in the unassigned pool and can be distributed
    // manually. We still log so the failure is visible.
    console.error(
      '[lead-mailbox-bridge] distribution failed for lead',
      lead.id,
      err
    );
  }

  return {
    status: 'processed',
    code: 201,
    // `status: "ok"` is intentional: Lead Mailbox's default Success
    // String is `"status":"ok"` and it matches against the raw response
    // body. Keeping this field stable means every LM Service pointed at
    // the bridge reports success without per-Service config changes.
    body: {
      status: 'ok',
      success: true,
      leadId: lead.id,
      source: 'lead-mailbox-bridge',
      vendor: vendor.slug,
      campaign: campaign?.routingTag ?? null,
    },
    leadId: lead.id,
    skipReason: null,
  };
}

// ---------- Generic vendor webhook (/api/webhooks/leads/[slug]) ----------

type FieldMapping = Record<string, string>;

function getNestedValue(
  obj: Record<string, unknown>,
  path: string
): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (
      acc &&
      typeof acc === 'object' &&
      key in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function applyFieldMapping(
  payload: Record<string, unknown>,
  mapping: FieldMapping
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [vendorField, ourField] of Object.entries(mapping)) {
    const raw = getNestedValue(payload, vendorField);
    result[ourField] = raw != null ? String(raw) : null;
  }
  return result;
}

const LEAD_FIELDS = new Set([
  'firstName', 'lastName', 'email', 'phone', 'homePhone', 'workPhone', 'dob',
  'ssn',
  'coFirstName', 'coLastName', 'coEmail', 'coPhone', 'coHomePhone', 'coWorkPhone', 'coDob',
  'mailingAddress', 'mailingCity', 'mailingState', 'mailingZip', 'mailingCounty',
  'propertyAddress', 'propertyCity', 'propertyState', 'propertyZip', 'propertyCounty',
  'purchasePrice', 'propertyValue', 'propertyType', 'propertyUse', 'propertyAcquired', 'propertyLtv',
  'employer', 'jobTitle', 'employmentLength', 'selfEmployed', 'income', 'bankruptcy', 'foreclosure', 'homeowner',
  'coEmployer', 'coJobTitle', 'coEmploymentLength', 'coSelfEmployed', 'coIncome',
  'loanPurpose', 'loanAmount', 'loanTerm', 'loanType', 'loanRate',
  'downPayment', 'cashOut', 'creditRating',
  'currentLender', 'currentBalance', 'currentRate', 'currentPayment', 'currentTerm', 'currentType',
  'otherBalance', 'otherPayment', 'targetRate',
  'vaStatus', 'vaLoan', 'isMilitary', 'fhaLoan', 'sourceUrl',
  'leadCreated',
]);

export type VendorLeadIngestInput = {
  vendorSlug: string;
  payload: Record<string, unknown>;
  signatureHeader?: string | null;
};

export async function ingestVendorLeadWebhook(
  input: VendorLeadIngestInput
): Promise<IngestResult> {
  const { vendorSlug, payload, signatureHeader = null } = input;

  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: vendorSlug },
  });

  if (!vendor || !vendor.active) {
    return {
      status: 'skipped',
      code: 404,
      body: { error: 'Unknown or inactive vendor' },
      leadId: null,
      skipReason: `Unknown or inactive vendor slug "${vendorSlug}"`,
    };
  }

  if (vendor.webhookSecret && signatureHeader !== null) {
    if (
      signatureHeader !== vendor.webhookSecret &&
      signatureHeader !== `Bearer ${vendor.webhookSecret}`
    ) {
      return {
        status: 'skipped',
        code: 401,
        body: { error: 'Unauthorized' },
        leadId: null,
        skipReason: 'Invalid webhook signature',
      };
    }
  }

  const routingTagValue = getNestedValue(payload, vendor.routingTagField);
  const routingTag = routingTagValue != null ? String(routingTagValue) : null;

  let campaign: Awaited<
    ReturnType<typeof prisma.leadCampaign.findUnique>
  > = null;
  if (routingTag) {
    const match = await prisma.leadCampaign.findUnique({
      where: { vendorId_routingTag: { vendorId: vendor.id, routingTag } },
    });
    if (match?.active) campaign = match;
  }

  const vendorLeadId =
    (payload.lead_id as string) ||
    (payload.leadId as string) ||
    (payload.id as string) ||
    null;

  if (campaign?.duplicateHandling === 'REJECT' && vendorLeadId) {
    const existing = await prisma.lead.findFirst({
      where: { vendorId: vendor.id, vendorLeadId },
    });
    if (existing) {
      return {
        status: 'skipped',
        code: 409,
        body: { error: 'Duplicate lead rejected', leadId: existing.id },
        leadId: existing.id,
        skipReason: `Duplicate vendorLeadId=${vendorLeadId} (REJECT policy)`,
      };
    }
  }

  const mapping = (vendor.fieldMapping as FieldMapping) || {};
  const mapped = applyFieldMapping(payload, mapping);

  const leadFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (!LEAD_FIELDS.has(key) || value == null) continue;
    if (key === 'isMilitary') {
      const canonical = normalizeMilitaryFlag(value);
      leadFields[key] = canonical ?? value;
      continue;
    }
    leadFields[key] = value;
  }

  const statusStr = campaign?.defaultLeadStatus ?? 'UNASSIGNED';
  const status = (Object.values(LeadStatus) as string[]).includes(statusStr)
    ? (statusStr as LeadStatus)
    : LeadStatus.UNASSIGNED;

  const createData: Prisma.LeadUncheckedCreateInput = {
    vendorLeadId,
    vendorId: vendor.id,
    campaignId: campaign?.id ?? null,
    status,
    source: routingTag || vendor.name,
    rawPayload: payload as Prisma.InputJsonValue,
    receivedAt: new Date(),
  };

  for (const [k, v] of Object.entries(leadFields)) {
    (createData as Record<string, unknown>)[k] = v;
  }

  const lead = await prisma.lead.create({ data: createData });

  void runServiceTriggers(lead.id, IntegrationServiceTrigger.ON_RECEIVE);
  void runServiceTriggers(
    lead.id,
    IntegrationServiceTrigger.DELAY_AFTER_RECEIVE
  );

  try {
    await distributeLead(lead.id);
  } catch (err) {
    console.error('[lead-webhook] distribution failed for lead', lead.id, err);
  }

  return {
    status: 'processed',
    code: 201,
    body: { success: true, leadId: lead.id },
    leadId: lead.id,
    skipReason: null,
  };
}
