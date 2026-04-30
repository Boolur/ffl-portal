'use server';

/**
 * Server actions backing the Lead Distribution Health page
 * (`/admin/leads/health`). Two responsibilities:
 *
 *   1. `getLeadMappingAudit` — read-only diagnostic that scans a recent
 *      slice of leads for a given vendor and reports how many would
 *      benefit from the phone fallback / mailing-mirror fixes shipped
 *      alongside this file. Mirrors `src/scripts/auditFruBonzoMapping.mjs`.
 *
 *   2. `getLeadAddressBackfillPreview` / `runLeadAddressBackfill` —
 *      dry-run + apply for the historical address backfill. Mirrors
 *      `src/scripts/backfillLeadAddresses.mjs` so admins don't have to
 *      shell out to fix old leads after re-pasting LMB templates.
 *
 * Both actions gate on the same admin role used elsewhere in lead
 * distribution (`isAdminRole(role) || MANAGER`). Vendor is identified by
 * slug so the URL / form payload stays stable across environments.
 */

import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  IntegrationServiceTrigger,
  Prisma,
  ServiceDispatchStatus,
  UserRole,
} from '@prisma/client';
import { isAdmin as isAdminRole } from '@/lib/adminTiers';
import { dispatchServiceToLead } from '@/lib/services/dispatch';
import {
  forwardLeadToBonzo,
  type BonzoForwardAudit,
} from '@/lib/bonzoForward';

async function assertDistributionAdmin() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role as UserRole | undefined;
  const allowed = isAdminRole(role) || role === UserRole.MANAGER;
  if (!allowed) throw new Error('Unauthorized');
  return session;
}

// Same regex the live ingest uses (src/lib/webhookIngest.ts) so the
// audit's "would-this-be-recoverable" answer matches what the webhook
// would actually do on replay.
const UNSUBSTITUTED_PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

function normalizeStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  if (UNSUBSTITUTED_PLACEHOLDER.test(str)) return null;
  return str;
}

// Address aliases per `Lead.property*` column. Kept in sync with
// `src/lib/leadMailboxBridge.ts` LEAD_MAILBOX_FIELD_MAP and the standalone
// backfill script. Order matters: first-non-empty-wins, mirroring how
// the bridge first-match-wins on payload key insertion order.
const ADDRESS_ALIASES: Record<string, string[]> = {
  propertyAddress: [
    'property_address',
    'phys_address',
    'mailing_address',
    'Mail_Address',
    'mail_address',
    'subject_property_address',
    'address',
    'address_line_1',
    'street',
    'street_1',
    'street1',
  ],
  propertyCity: [
    'property_city',
    'phys_city',
    'mailing_city',
    'Mail_City',
    'mail_city',
    'subject_property_city',
    'city',
  ],
  propertyState: [
    'property_state',
    'phys_state',
    'mailing_state',
    'Mail_State',
    'mail_state',
    'subject_property_state',
    'state',
  ],
  propertyZip: [
    'property_zip',
    'phys_zip',
    'mailing_zip',
    'Mail_Zip',
    'mail_zip',
    'subject_property_zip',
    'zip',
    'zip_code',
    'postal_code',
  ],
  propertyCounty: [
    'property_county',
    'phys_county',
    'mailing_county',
    'Mail_County',
    'mail_county',
    'subject_property_county',
    'county',
  ],
};

const MAILING_RAW_KEYS = [
  'mailing_address',
  'Mail_Address',
  'mail_address',
];

function findFirstValue(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const lookup = new Map<string, unknown>();
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    lookup.set(k, v);
    lookup.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const raw = lookup.has(key)
      ? lookup.get(key)
      : lookup.get(key.toLowerCase());
    const normalized = normalizeStringValue(raw);
    if (normalized !== null) return normalized;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Vendor list (for the picker on the Health page)
// ---------------------------------------------------------------------------

export type AuditVendorOption = {
  slug: string;
  name: string;
  leadCount: number;
};

export async function getAuditVendors(): Promise<AuditVendorOption[]> {
  await assertDistributionAdmin();
  const vendors = await prisma.leadVendor.findMany({
    orderBy: { name: 'asc' },
    select: {
      slug: true,
      name: true,
      _count: { select: { leads: true } },
    },
  });
  return vendors.map((v) => ({
    slug: v.slug,
    name: v.name,
    leadCount: v._count.leads,
  }));
}

// ---------------------------------------------------------------------------
// Mapping audit
// ---------------------------------------------------------------------------

export type LeadMappingAuditInput = {
  vendorSlug: string;
  days?: number;
  limit?: number;
};

export type LeadMappingAuditSampleRow = {
  id: string;
  receivedAt: string;
  name: string;
  phone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  mailingAddress: string | null;
  loanType: string | null;
  loanTerm: string | null;
  // True if this lead would benefit from the new fixes, so the UI can
  // highlight it. Kept as a derived flag instead of computed in the
  // table so the page can sort / filter without re-running the math.
  phoneFixable: boolean;
  addressFixableViaMailing: boolean;
};

export type LeadMappingAuditResult = {
  vendorSlug: string;
  vendorName: string;
  scanned: number;
  windowDays: number;
  phoneNull: number;
  phoneNullButRecoverable: number;
  coPhoneNullWithCoBorrower: number;
  coPhoneNullButRecoverable: number;
  propertyAddressBlank: number;
  propertyAddressBlankWithMailingColumn: number;
  propertyAddressBlankWithMailingPayload: number;
  propertyAddressBlankUnrecoverable: number;
  topLoanType: Array<{ value: string; count: number }>;
  topLoanTerm: Array<{ value: string; count: number }>;
  sample: LeadMappingAuditSampleRow[];
};

export async function getLeadMappingAudit(
  input: LeadMappingAuditInput
): Promise<LeadMappingAuditResult> {
  await assertDistributionAdmin();
  const days = Math.max(1, Math.min(60, input.days ?? 7));
  const limit = Math.max(1, Math.min(1000, input.limit ?? 200));

  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: input.vendorSlug },
    select: { id: true, name: true, slug: true },
  });
  if (!vendor) throw new Error(`Unknown vendor slug "${input.vendorSlug}"`);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: { vendorId: vendor.id, receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      receivedAt: true,
      firstName: true,
      lastName: true,
      phone: true,
      homePhone: true,
      workPhone: true,
      coPhone: true,
      coHomePhone: true,
      coWorkPhone: true,
      propertyAddress: true,
      propertyCity: true,
      propertyState: true,
      propertyZip: true,
      mailingAddress: true,
      mailingCity: true,
      mailingState: true,
      mailingZip: true,
      loanType: true,
      loanTerm: true,
      rawPayload: true,
    },
  });

  let phoneNull = 0;
  let phoneNullButRecoverable = 0;
  let coPhoneNullWithCoBorrower = 0;
  let coPhoneNullButRecoverable = 0;
  let propertyAddressBlank = 0;
  let propertyAddressBlankWithMailingColumn = 0;
  let propertyAddressBlankWithMailingPayload = 0;
  let propertyAddressBlankUnrecoverable = 0;

  const loanTypeCounts = new Map<string, number>();
  const loanTermCounts = new Map<string, number>();

  const sample: LeadMappingAuditSampleRow[] = [];

  for (const lead of leads) {
    const phoneFixable = Boolean(
      !lead.phone && (lead.homePhone || lead.workPhone)
    );
    if (!lead.phone) {
      phoneNull += 1;
      if (lead.homePhone || lead.workPhone) phoneNullButRecoverable += 1;
    }

    const hasCoBorrower = Boolean(lead.coHomePhone || lead.coWorkPhone);
    if (hasCoBorrower && !lead.coPhone) {
      coPhoneNullWithCoBorrower += 1;
      coPhoneNullButRecoverable += 1;
    }

    let addressFixableViaMailing = false;
    if (!lead.propertyAddress) {
      propertyAddressBlank += 1;
      if (lead.mailingAddress) {
        propertyAddressBlankWithMailingColumn += 1;
        addressFixableViaMailing = true;
      } else {
        const fromPayload = findFirstValue(lead.rawPayload, MAILING_RAW_KEYS);
        if (fromPayload) {
          propertyAddressBlankWithMailingPayload += 1;
          addressFixableViaMailing = true;
        } else {
          // No mailing-style key recoverable from rawPayload either.
          // Distinguish "truly unrecoverable" from "phys exists but
          // wasn't applied" so admins can act on the right bucket.
          const fromAnyAlias = findFirstValue(
            lead.rawPayload,
            ADDRESS_ALIASES.propertyAddress
          );
          if (!fromAnyAlias) propertyAddressBlankUnrecoverable += 1;
        }
      }
    }

    const lt = lead.loanType?.trim() || '(blank)';
    const lterm = lead.loanTerm?.trim() || '(blank)';
    loanTypeCounts.set(lt, (loanTypeCounts.get(lt) ?? 0) + 1);
    loanTermCounts.set(lterm, (loanTermCounts.get(lterm) ?? 0) + 1);

    if (sample.length < 25) {
      sample.push({
        id: lead.id,
        receivedAt: lead.receivedAt.toISOString(),
        name:
          [lead.firstName, lead.lastName].filter(Boolean).join(' ') ||
          '(no name)',
        phone: lead.phone,
        homePhone: lead.homePhone,
        workPhone: lead.workPhone,
        propertyAddress: lead.propertyAddress,
        propertyCity: lead.propertyCity,
        propertyState: lead.propertyState,
        propertyZip: lead.propertyZip,
        mailingAddress: lead.mailingAddress,
        loanType: lead.loanType,
        loanTerm: lead.loanTerm,
        phoneFixable,
        addressFixableViaMailing,
      });
    }
  }

  const top = (m: Map<string, number>): Array<{ value: string; count: number }> =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, count]) => ({ value, count }));

  return {
    vendorSlug: vendor.slug,
    vendorName: vendor.name,
    scanned: leads.length,
    windowDays: days,
    phoneNull,
    phoneNullButRecoverable,
    coPhoneNullWithCoBorrower,
    coPhoneNullButRecoverable,
    propertyAddressBlank,
    propertyAddressBlankWithMailingColumn,
    propertyAddressBlankWithMailingPayload,
    propertyAddressBlankUnrecoverable,
    topLoanType: top(loanTypeCounts),
    topLoanTerm: top(loanTermCounts),
    sample,
  };
}

// ---------------------------------------------------------------------------
// Address backfill
// ---------------------------------------------------------------------------

export type AddressBackfillInput = {
  // null / undefined = all vendors
  vendorSlug?: string | null;
  // Hard cap so a single click can't lock the table for minutes on a
  // 100k-row import. The CLI script defaults to "no limit"; the UI
  // defaults to 500 to keep the request snappy and lets admins re-run
  // until the unrecoverable bucket settles.
  limit?: number;
};

export type AddressBackfillRecoverableRow = {
  leadId: string;
  vendorSlug: string;
  name: string;
  newAddress: string;
  newCity: string | null;
  newState: string | null;
  newZip: string | null;
  newCounty: string | null;
};

export type AddressBackfillUnrecoverableRow = {
  leadId: string;
  vendorSlug: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
};

export type AddressBackfillSummary = {
  scanned: number;
  totalCandidates: number;
  recoverable: number;
  unrecoverable: number;
  byVendor: Array<{ vendorSlug: string; total: number; recoverable: number }>;
  // Sample rows for the UI (capped, not all of them).
  sampleRecoverable: AddressBackfillRecoverableRow[];
  sampleUnrecoverable: AddressBackfillUnrecoverableRow[];
};

export type AddressBackfillApplyResult = AddressBackfillSummary & {
  applied: number;
  failed: number;
};

async function loadBackfillCandidates(
  vendorSlug: string | null,
  limit: number
) {
  const where = {
    propertyAddress: null,
    ...(vendorSlug
      ? { vendor: { slug: vendorSlug.toLowerCase() } }
      : {}),
  };

  // Run count + findMany in parallel. We could short-circuit findMany
  // when count is 0, but doing so forced us to type the empty branch
  // against the wide `Lead` model (no select) which loses the narrow
  // `vendor` projection. With the IS NULL + indexed `vendorId` filter
  // findMany on an empty result set is cheap, so the parallelism wins
  // either way.
  const [totalCandidates, leads] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        propertyCounty: true,
        rawPayload: true,
        vendor: { select: { slug: true } },
      },
      orderBy: { receivedAt: 'asc' },
      take: limit,
    }),
  ]);

  return { totalCandidates, leads };
}

type ResolvedRow = {
  leadId: string;
  vendorSlug: string;
  name: string;
  updates: Record<string, string>;
  recoverable: boolean;
  city: string | null;
  state: string | null;
  zip: string | null;
};

function resolveBackfillRow(lead: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyCounty: string | null;
  rawPayload: unknown;
  vendor: { slug: string } | null;
}): ResolvedRow {
  const found = {
    propertyAddress: findFirstValue(lead.rawPayload, ADDRESS_ALIASES.propertyAddress),
    propertyCity: findFirstValue(lead.rawPayload, ADDRESS_ALIASES.propertyCity),
    propertyState: findFirstValue(lead.rawPayload, ADDRESS_ALIASES.propertyState),
    propertyZip: findFirstValue(lead.rawPayload, ADDRESS_ALIASES.propertyZip),
    propertyCounty: findFirstValue(lead.rawPayload, ADDRESS_ALIASES.propertyCounty),
  };

  const updates: Record<string, string> = {};
  if (found.propertyAddress) {
    updates.propertyAddress = found.propertyAddress;
  }
  if (found.propertyCity && !lead.propertyCity) {
    updates.propertyCity = found.propertyCity;
  }
  if (found.propertyState && !lead.propertyState) {
    updates.propertyState = found.propertyState;
  }
  if (found.propertyZip && !lead.propertyZip) {
    updates.propertyZip = found.propertyZip;
  }
  if (found.propertyCounty && !lead.propertyCounty) {
    updates.propertyCounty = found.propertyCounty;
  }

  return {
    leadId: lead.id,
    vendorSlug: lead.vendor?.slug ?? '(unknown)',
    name:
      [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)',
    updates,
    recoverable: Boolean(updates.propertyAddress),
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
  };
}

function summarize(
  rows: ResolvedRow[],
  totalCandidates: number
): AddressBackfillSummary {
  const recoverable = rows.filter((r) => r.recoverable);
  const unrecoverable = rows.filter((r) => !r.recoverable);
  const vendorMap = new Map<string, { total: number; recoverable: number }>();
  for (const r of rows) {
    const stat = vendorMap.get(r.vendorSlug) ?? { total: 0, recoverable: 0 };
    stat.total += 1;
    if (r.recoverable) stat.recoverable += 1;
    vendorMap.set(r.vendorSlug, stat);
  }
  return {
    scanned: rows.length,
    totalCandidates,
    recoverable: recoverable.length,
    unrecoverable: unrecoverable.length,
    byVendor: [...vendorMap.entries()]
      .sort((a, b) => b[1].recoverable - a[1].recoverable)
      .map(([slug, stat]) => ({ vendorSlug: slug, ...stat })),
    sampleRecoverable: recoverable.slice(0, 25).map((r) => ({
      leadId: r.leadId,
      vendorSlug: r.vendorSlug,
      name: r.name,
      newAddress: r.updates.propertyAddress ?? '',
      newCity: r.updates.propertyCity ?? r.city,
      newState: r.updates.propertyState ?? r.state,
      newZip: r.updates.propertyZip ?? r.zip,
      newCounty: r.updates.propertyCounty ?? null,
    })),
    sampleUnrecoverable: unrecoverable.slice(0, 25).map((r) => ({
      leadId: r.leadId,
      vendorSlug: r.vendorSlug,
      name: r.name,
      city: r.city,
      state: r.state,
      zip: r.zip,
    })),
  };
}

export async function getLeadAddressBackfillPreview(
  input: AddressBackfillInput
): Promise<AddressBackfillSummary> {
  await assertDistributionAdmin();
  const limit = Math.max(1, Math.min(2000, input.limit ?? 500));
  const { totalCandidates, leads } = await loadBackfillCandidates(
    input.vendorSlug ?? null,
    limit
  );
  const rows = leads.map(resolveBackfillRow);
  return summarize(rows, totalCandidates);
}

export async function runLeadAddressBackfill(
  input: AddressBackfillInput
): Promise<AddressBackfillApplyResult> {
  await assertDistributionAdmin();
  const limit = Math.max(1, Math.min(2000, input.limit ?? 500));
  const { totalCandidates, leads } = await loadBackfillCandidates(
    input.vendorSlug ?? null,
    limit
  );
  const rows = leads.map(resolveBackfillRow);
  const summary = summarize(rows, totalCandidates);

  let applied = 0;
  let failed = 0;
  // Sequential updates, mirroring the CLI script. The candidate set is
  // bounded by `limit` (default 500) so we don't need a transaction —
  // partial progress on a transient DB hiccup is fine because re-running
  // the action picks up where it left off (propertyAddress is now
  // non-null on the rows we did update, so they fall out of the filter).
  for (const r of rows) {
    if (!r.recoverable) continue;
    try {
      await prisma.lead.update({
        where: { id: r.leadId },
        data: r.updates,
      });
      applied += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `[lead-health] backfill update failed for ${r.leadId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { ...summary, applied, failed };
}

// ---------------------------------------------------------------------------
// Broker Launch email status (automated email to assigned LO on assignment)
// ---------------------------------------------------------------------------

/**
 * Slug of the seeded IntegrationService row that fires the Broker Launch
 * Notification email (see prisma/migrations/20260428010100_seed_broker_
 * launch_email_service/migration.sql). Hardcoded here because there is
 * exactly one email service today; if a second one ever ships we should
 * widen this to filter by `method = EMAIL_BROKER_LAUNCH` instead.
 */
const BROKER_LAUNCH_SLUG = 'broker-launch-email';

const MS_ENV_VARS = [
  'MS_TENANT_ID',
  'MS_CLIENT_ID',
  'MS_CLIENT_SECRET',
  'MS_SENDER_EMAIL',
] as const;

export type BrokerLaunchDispatchRow = {
  dispatchId: string;
  status: ServiceDispatchStatus;
  trigger: IntegrationServiceTrigger;
  createdAt: string;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  skippedReason: string | null;
  // Snapshot of the recipient (`to:`) the dispatcher captured at send
  // time. Useful when the assigned user has since rotated their email
  // — we want to show the address we actually tried, not the one
  // currently on the user row.
  recipient: string | null;
  leadId: string;
  leadName: string;
  leadVendorSlug: string | null;
  assignedUserId: string | null;
  assignedUserEmail: string | null;
  assignedUserName: string | null;
};

export type BrokerLaunchEmailStatus = {
  service: {
    id: string;
    slug: string;
    name: string;
    active: boolean;
  } | null;
  // Microsoft Graph configuration check. We never echo the actual values
  // back to the client — only which env vars are missing — so the page
  // is safe to view even at lower admin tiers.
  env: {
    ok: boolean;
    missing: string[];
  };
  lookbackDays: number;
  // ISO timestamp of the start of the coverage window. Equal to
  // `now - lookbackDays` unless the IntegrationService row was
  // created more recently, in which case it's clamped to that
  // creation time. The flag below tells the UI to surface the clamp.
  coverageWindowStart: string;
  coverageClampedToService: boolean;
  counts: {
    sent: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  // Compares "leads assigned via Lead.assignedAt within the coverage
  // window" vs "broker-launch dispatch rows created in the same window".
  // A meaningful gap means trigger wiring is missing somewhere (e.g.
  // someone introduced a new assignment path that doesn't call
  // runServiceTriggers ON_ASSIGN).
  coverage: {
    leadsAssignedInWindow: number;
    dispatchesInWindow: number;
    gap: number;
  };
  recentFailed: BrokerLaunchDispatchRow[];
  recentSkipped: BrokerLaunchDispatchRow[];
  recentSent: BrokerLaunchDispatchRow[];
};

type DispatchWithRelations = {
  id: string;
  status: ServiceDispatchStatus;
  trigger: IntegrationServiceTrigger;
  createdAt: Date;
  completedAt: Date | null;
  attempts: number;
  lastError: string | null;
  skippedReason: string | null;
  requestSnapshot: unknown;
  leadId: string;
  lead: {
    firstName: string | null;
    lastName: string | null;
    assignedUserId: string | null;
    assignedUser: {
      id: string;
      email: string | null;
      name: string | null;
    } | null;
    vendor: { slug: string } | null;
  };
};

function extractRecipientFromSnapshot(snapshot: unknown): string | null {
  // The dispatcher writes `{ transport, method, subject, to }` for email
  // services (see dispatch.ts ~237). Falling back to null lets the UI
  // render "—" for legacy rows that pre-dated the snapshot field.
  if (!snapshot || typeof snapshot !== 'object') return null;
  const to = (snapshot as Record<string, unknown>).to;
  return typeof to === 'string' && to.length > 0 ? to : null;
}

function toDispatchRow(d: DispatchWithRelations): BrokerLaunchDispatchRow {
  const fullName =
    [d.lead.firstName, d.lead.lastName].filter(Boolean).join(' ') ||
    '(no name)';
  return {
    dispatchId: d.id,
    status: d.status,
    trigger: d.trigger,
    createdAt: d.createdAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    attempts: d.attempts,
    lastError: d.lastError,
    skippedReason: d.skippedReason,
    recipient: extractRecipientFromSnapshot(d.requestSnapshot),
    leadId: d.leadId,
    leadName: fullName,
    leadVendorSlug: d.lead.vendor?.slug ?? null,
    assignedUserId: d.lead.assignedUserId,
    assignedUserEmail: d.lead.assignedUser?.email ?? null,
    assignedUserName: d.lead.assignedUser?.name ?? null,
  };
}

export type BrokerLaunchEmailStatusInput = {
  days?: number;
};

export async function getBrokerLaunchEmailStatus(
  input: BrokerLaunchEmailStatusInput = {}
): Promise<BrokerLaunchEmailStatus> {
  await assertDistributionAdmin();
  const days = Math.max(1, Math.min(60, input.days ?? 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Env presence is computed server-side so we can flag misconfiguration
  // without ever sending the values to the browser.
  const missingEnv = MS_ENV_VARS.filter((name) => !process.env[name]);

  const service = await prisma.integrationService.findUnique({
    where: { slug: BROKER_LAUNCH_SLUG },
    select: { id: true, slug: true, name: true, active: true, createdAt: true },
  });

  // If the service row hasn't been seeded yet (fresh DB) we still want
  // the page to render — the env + assignment counts are still useful.
  if (!service) {
    return {
      service: null,
      env: { ok: missingEnv.length === 0, missing: missingEnv },
      lookbackDays: days,
      coverageWindowStart: since.toISOString(),
      coverageClampedToService: false,
      counts: { sent: 0, failed: 0, skipped: 0, pending: 0 },
      coverage: {
        leadsAssignedInWindow: 0,
        dispatchesInWindow: 0,
        gap: 0,
      },
      recentFailed: [],
      recentSkipped: [],
      recentSent: [],
    };
  }

  // Clamp the coverage window to the service's createdAt so we don't
  // count assignments that happened before the broker-launch service
  // existed. Otherwise the gap looks alarming on a freshly-promoted
  // service even though everything is healthy — pre-service assignments
  // legitimately have no dispatch row.
  const coverageStart =
    service.createdAt > since ? service.createdAt : since;
  const coverageClampedToService = service.createdAt > since;

  // Counts are intentionally bounded by the user's chosen lookback
  // (`since`), not the clamped coverage window. Admins still want to
  // see the SENT/FAILED totals for the period they selected; the
  // coverage banner is the only thing that needs the clamp.
  const grouped = await prisma.serviceDispatch.groupBy({
    by: ['status'],
    where: {
      serviceId: service.id,
      createdAt: { gte: since },
    },
    _count: { _all: true },
  });
  const counts = { sent: 0, failed: 0, skipped: 0, pending: 0 };
  for (const g of grouped) {
    if (g.status === ServiceDispatchStatus.SENT) counts.sent = g._count._all;
    else if (g.status === ServiceDispatchStatus.FAILED)
      counts.failed = g._count._all;
    else if (g.status === ServiceDispatchStatus.SKIPPED)
      counts.skipped = g._count._all;
    else if (g.status === ServiceDispatchStatus.PENDING)
      counts.pending = g._count._all;
  }

  // Dispatches counted against the same clamped window the assignment
  // count uses, so the gap math is meaningful.
  const dispatchesInWindow = await prisma.serviceDispatch.count({
    where: {
      serviceId: service.id,
      createdAt: { gte: coverageStart },
    },
  });

  // "Leads assigned in window" — uses `Lead.assignedAt` (set by every
  // assignment path: distributeLead, assignLead, bulkAssignLeads, CSV
  // import). Clamped to coverageStart so we don't claim assignments
  // pre-dating the broker-launch service should have produced a
  // dispatch row.
  const leadsAssignedInWindow = await prisma.lead.count({
    where: { assignedAt: { gte: coverageStart } },
  });

  const include = {
    lead: {
      select: {
        firstName: true,
        lastName: true,
        assignedUserId: true,
        assignedUser: {
          select: { id: true, email: true, name: true },
        },
        vendor: { select: { slug: true } },
      },
    },
  } as const;

  const [failedRows, skippedRows, sentRows] = await Promise.all([
    prisma.serviceDispatch.findMany({
      where: {
        serviceId: service.id,
        status: ServiceDispatchStatus.FAILED,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include,
    }),
    prisma.serviceDispatch.findMany({
      where: {
        serviceId: service.id,
        status: ServiceDispatchStatus.SKIPPED,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      include,
    }),
    prisma.serviceDispatch.findMany({
      where: {
        serviceId: service.id,
        status: ServiceDispatchStatus.SENT,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include,
    }),
  ]);

  return {
    service: {
      id: service.id,
      slug: service.slug,
      name: service.name,
      active: service.active,
    },
    env: { ok: missingEnv.length === 0, missing: missingEnv },
    lookbackDays: days,
    coverageWindowStart: coverageStart.toISOString(),
    coverageClampedToService,
    counts,
    coverage: {
      leadsAssignedInWindow,
      dispatchesInWindow,
      gap: Math.max(0, leadsAssignedInWindow - dispatchesInWindow),
    },
    recentFailed: failedRows.map(toDispatchRow),
    recentSkipped: skippedRows.map(toDispatchRow),
    recentSent: sentRows.map(toDispatchRow),
  };
}

export type BrokerLaunchRetryResult = {
  ok: boolean;
  // The new dispatch row outcome rendered as a single short string so
  // the UI can flash a confirmation toast without re-running the whole
  // status query.
  message: string;
};

export async function retryBrokerLaunchDispatch(
  dispatchId: string
): Promise<BrokerLaunchRetryResult> {
  await assertDistributionAdmin();

  const dispatch = await prisma.serviceDispatch.findUnique({
    where: { id: dispatchId },
    select: {
      id: true,
      leadId: true,
      service: {
        // dispatchServiceToLead expects credentialFields preloaded.
        // EMAIL_BROKER_LAUNCH ignores credentials, but we honor the
        // shape so the helper stays a drop-in dispatch entry point.
        include: { credentialFields: true },
      },
    },
  });
  if (!dispatch) {
    return { ok: false, message: 'Dispatch row not found.' };
  }
  if (dispatch.service.slug !== BROKER_LAUNCH_SLUG) {
    return {
      ok: false,
      message: 'Refusing to retry a non broker-launch dispatch from this surface.',
    };
  }

  // Run as a MANUAL dispatch so the retry is clearly distinguishable
  // from the original automated firing in the audit log.
  const outcome = await dispatchServiceToLead(
    dispatch.service,
    dispatch.leadId,
    { trigger: IntegrationServiceTrigger.MANUAL }
  );

  if (outcome.ok) {
    return { ok: true, message: 'Email sent.' };
  }
  if ('skipped' in outcome && outcome.skipped) {
    return {
      ok: false,
      message: `Skipped: ${outcome.reason}${outcome.info ? ` — ${outcome.info}` : ''}`,
    };
  }
  return {
    ok: false,
    message: `Failed: ${outcome.reason}${outcome.info ? ` — ${outcome.info}` : ''}`,
  };
}

/**
 * Returns the list of FAILED broker-launch dispatch IDs in the lookback
 * window so the client can drive a per-row retry loop with live
 * progress. Doing this client-side (vs the previous "retry all" server
 * action that looped 66+ rows in one request) gives admins immediate
 * feedback and dodges the Vercel serverless function timeout that
 * killed long-running batches.
 */
export async function getFailedBrokerLaunchDispatchIds(
  input: { days?: number } = {}
): Promise<string[]> {
  await assertDistributionAdmin();
  const days = Math.max(1, Math.min(60, input.days ?? 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const service = await prisma.integrationService.findUnique({
    where: { slug: BROKER_LAUNCH_SLUG },
    select: { id: true },
  });
  if (!service) return [];

  const rows = await prisma.serviceDispatch.findMany({
    where: {
      serviceId: service.id,
      status: ServiceDispatchStatus.FAILED,
      createdAt: { gte: since },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    // Hard cap so a click can't queue up thousands of round-trips if a
    // legitimate ops issue produced a flood of FAILED rows. Admins can
    // re-run the loop to clean up the rest.
    take: 500,
  });
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Bonzo forward status (auto-push of every assigned lead to user webhook)
// ---------------------------------------------------------------------------

export type BonzoForwardSampleRow = {
  leadId: string;
  leadName: string;
  vendorSlug: string | null;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
  assignedUserId: string;
  assignedAt: string | null;
  forwardAt: string | null;
  outcome:
    | 'sent'
    | 'http_error'
    | 'no_webhook_url'
    | 'no_lead'
    | 'exception'
    | 'never_attempted';
  status: number | null;
  errorPreview: string | null;
  // Where the audit signal came from. `auto` = the auto-forward path
  // (Lead.customData.lastBonzoForward, set by forwardLeadToBonzo on
  // assignment). `manual` = the admin Push to Service modal, detected
  // by joining ServiceDispatch SENT rows for any IntegrationService
  // whose urlTemplate contains "bonzo". `none` = no audit row from
  // either source — the genuine "never attempted" bucket.
  source: 'auto' | 'manual' | 'none';
  // Slug of the IntegrationService that pushed the lead (only set for
  // source='manual'); useful when the user has multiple Bonzo services
  // configured (e.g. one per brand) and wants to know which one fired.
  manualServiceSlug: string | null;
};

export type BonzoForwardStatus = {
  lookbackDays: number;
  windowStart: string;
  // Slugs of every IntegrationService we matched as a "Bonzo service"
  // for the manual-push cross-reference. Surfaced in the UI so admins
  // can confirm we caught the right ones (and add a service whose URL
  // doesn't contain "bonzo" if necessary).
  manualBonzoServices: Array<{ slug: string; name: string }>;
  // CSV-uploaded leads (vendor slug = "csv-upload") are excluded from
  // the panel because they're historical bulk imports — admins decide
  // at upload time whether to fire the Bonzo forward via the CSV
  // wizard. Counting them here would explode the "never attempted"
  // bucket with leads that intentionally never had auto-forward fire.
  excludedCsvLeads: number;
  totals: {
    assigned: number;
    forwarded: number;
    sent: number; // includes both auto and manual successful pushes
    sentAuto: number;
    sentManual: number;
    httpError: number;
    noWebhookUrl: number;
    exception: number;
    neverAttempted: number;
  };
  // Top error preview / status combos, so a recurring 422 with the same
  // message floats to the top instead of being buried in 500 sample rows.
  topErrors: Array<{ key: string; count: number }>;
  // Recent failures grouped sample (caps for UI). HTTP errors are usually
  // the most actionable bucket so we surface them first.
  recentHttpErrors: BonzoForwardSampleRow[];
  recentExceptions: BonzoForwardSampleRow[];
  recentNoWebhook: BonzoForwardSampleRow[];
  recentNeverAttempted: BonzoForwardSampleRow[];
  recentSent: BonzoForwardSampleRow[];
};

function readBonzoAudit(customData: unknown): BonzoForwardAudit | null {
  if (!customData || typeof customData !== 'object' || Array.isArray(customData)) {
    return null;
  }
  const last = (customData as Record<string, unknown>).lastBonzoForward;
  if (!last || typeof last !== 'object' || Array.isArray(last)) {
    return null;
  }
  const audit = last as Record<string, unknown>;
  if (typeof audit.at !== 'string' || typeof audit.outcome !== 'string') {
    return null;
  }
  return audit as unknown as BonzoForwardAudit;
}

type RawLeadRow = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  assignedAt: Date | null;
  assignedUserId: string | null;
  assignedUser: { id: string; name: string | null; email: string | null } | null;
  vendor: { slug: string } | null;
  customData: Prisma.JsonValue;
};

type ManualPush = {
  serviceSlug: string;
  serviceName: string;
  completedAt: string;
};

function toBonzoSampleRow(
  lead: RawLeadRow,
  audit: BonzoForwardAudit | null,
  manualPush: ManualPush | null
): BonzoForwardSampleRow {
  const base = {
    leadId: lead.id,
    leadName:
      [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)',
    vendorSlug: lead.vendor?.slug ?? null,
    assignedUserId: lead.assignedUserId ?? '',
    assignedUserName: lead.assignedUser?.name ?? null,
    assignedUserEmail: lead.assignedUser?.email ?? null,
    assignedAt: lead.assignedAt ? lead.assignedAt.toISOString() : null,
  };

  // Auto wins over manual when both exist — the auto audit is the
  // source of truth for whether the assignment-time push succeeded
  // and is what determines health-banner color. Manual pushes are
  // surfaced separately in totals.sentManual so admins can still see
  // their manual sends are landing.
  if (audit) {
    return {
      ...base,
      forwardAt: audit.at,
      outcome: audit.outcome,
      status: audit.status ?? null,
      errorPreview: audit.errorPreview ?? audit.statusText ?? null,
      source: 'auto',
      manualServiceSlug: null,
    };
  }
  if (manualPush) {
    return {
      ...base,
      forwardAt: manualPush.completedAt,
      outcome: 'sent',
      status: null,
      errorPreview: null,
      source: 'manual',
      manualServiceSlug: manualPush.serviceSlug,
    };
  }
  return {
    ...base,
    forwardAt: null,
    outcome: 'never_attempted',
    status: null,
    errorPreview: null,
    source: 'none',
    manualServiceSlug: null,
  };
}

/**
 * System vendor slug used for every CSV-imported lead. Kept in sync
 * with src/app/actions/leadActions.ts (CSV_VENDOR_SLUG) — both files
 * need to know it but neither owns the other, and copying a single
 * string constant is cheaper than introducing a shared module just
 * for one identifier. Renaming it requires updating both spots.
 */
const CSV_VENDOR_SLUG = 'csv-upload';

export async function getBonzoForwardStatus(
  input: { days?: number } = {}
): Promise<BonzoForwardStatus> {
  await assertDistributionAdmin();
  const days = Math.max(1, Math.min(60, input.days ?? 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Resolve the CSV vendor id once so we can filter at the query layer
  // instead of pulling 5k rows and discarding most of them. We treat a
  // missing CSV vendor row as "no exclusion needed" — the slug only
  // gets created the first time someone uploads a CSV, so a fresh org
  // wouldn't have one yet.
  const csvVendor = await prisma.leadVendor.findUnique({
    where: { slug: CSV_VENDOR_SLUG },
    select: { id: true },
  });
  const csvVendorId = csvVendor?.id ?? null;

  // Identify any IntegrationService configured to push to Bonzo so we
  // can credit manual "Push to Service" pushes. Heuristic: urlTemplate
  // contains "bonzo" (case-insensitive). Bonzo's official endpoint is
  // app.getbonzo.com, every legitimate Bonzo webhook URL contains the
  // brand string, and the user explicitly asked for manual pushes to
  // be counted alongside auto-forwards. EMAIL_BROKER_LAUNCH is excluded
  // because it doesn't have a meaningful URL template.
  const bonzoServices = await prisma.integrationService.findMany({
    where: {
      urlTemplate: { contains: 'bonzo', mode: 'insensitive' },
    },
    select: { id: true, slug: true, name: true },
  });
  const bonzoServiceById = new Map(bonzoServices.map((s) => [s.id, s]));

  // Count how many CSV leads we filtered out so the UI can show a
  // transparency line. Cheap query — same indexed (assignedAt,
  // vendorId) hot path the main lead query uses.
  const excludedCsvLeads = csvVendorId
    ? await prisma.lead.count({
        where: { assignedAt: { gte: since }, vendorId: csvVendorId },
      })
    : 0;

  // Pull every lead assigned in the window. We classify in JS because
  // Prisma's JSON filter API can't reliably index into nested keys
  // across all Postgres deploys. With the typical traffic shape (~hund-
  // reds/day) the row set is small enough that an in-memory bucket pass
  // is faster than firing 5 separate counts.
  const [leads, manualSentDispatches] = await Promise.all([
    prisma.lead.findMany({
      where: {
        assignedAt: { gte: since },
        // Exclude CSV uploads: those are historical bulk imports that
        // intentionally never went through the auto-forward path
        // (admins decide at upload time whether to push to Bonzo via
        // the CSV wizard). Counting them as "never attempted" pollutes
        // the panel with leads that aren't actionable from here.
        ...(csvVendorId ? { vendorId: { not: csvVendorId } } : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        assignedAt: true,
        assignedUserId: true,
        assignedUser: {
          select: { id: true, name: true, email: true },
        },
        vendor: { select: { slug: true } },
        customData: true,
      },
      orderBy: { assignedAt: 'desc' },
      // Cap to keep the request snappy even on a busy day. Anything
      // beyond this slips out of the sample but still counts in the
      // totals we tally below.
      take: 5000,
    }),
    bonzoServices.length === 0
      ? Promise.resolve([])
      : prisma.serviceDispatch.findMany({
          where: {
            serviceId: { in: bonzoServices.map((s) => s.id) },
            status: ServiceDispatchStatus.SENT,
            createdAt: { gte: since },
          },
          select: {
            leadId: true,
            serviceId: true,
            completedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
  ]);

  // Map each leadId -> most recent successful manual Bonzo push. The
  // findMany above is ordered desc, so the first hit per lead wins.
  const manualByLeadId = new Map<string, ManualPush>();
  for (const d of manualSentDispatches) {
    if (manualByLeadId.has(d.leadId)) continue;
    const svc = bonzoServiceById.get(d.serviceId);
    if (!svc) continue;
    manualByLeadId.set(d.leadId, {
      serviceSlug: svc.slug,
      serviceName: svc.name,
      completedAt: (d.completedAt ?? d.createdAt).toISOString(),
    });
  }

  let sent = 0;
  let sentAuto = 0;
  let sentManual = 0;
  let httpError = 0;
  let noWebhookUrl = 0;
  let exception = 0;
  let neverAttempted = 0;
  let forwarded = 0;

  const errorBuckets = new Map<string, number>();
  const recentHttpErrors: BonzoForwardSampleRow[] = [];
  const recentExceptions: BonzoForwardSampleRow[] = [];
  const recentNoWebhook: BonzoForwardSampleRow[] = [];
  const recentNeverAttempted: BonzoForwardSampleRow[] = [];
  const recentSent: BonzoForwardSampleRow[] = [];

  for (const lead of leads) {
    const audit = readBonzoAudit(lead.customData);
    const manualPush = manualByLeadId.get(lead.id) ?? null;
    const row = toBonzoSampleRow(lead, audit, manualPush);

    if (audit) {
      forwarded += 1;
      if (audit.outcome === 'sent') {
        sent += 1;
        sentAuto += 1;
        if (recentSent.length < 5) recentSent.push(row);
      } else if (audit.outcome === 'http_error') {
        httpError += 1;
        if (recentHttpErrors.length < 25) recentHttpErrors.push(row);
        const key = `HTTP ${audit.status ?? '?'}: ${(audit.errorPreview ?? audit.statusText ?? '').slice(0, 120)}`;
        errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
      } else if (audit.outcome === 'no_webhook_url') {
        // If the LO has no webhook BUT the lead was manually pushed
        // through a Bonzo service, treat it as covered. The auto
        // path correctly recorded "no webhook" for the LO, but the
        // admin already sent it manually so it's not actionable.
        if (manualPush) {
          sent += 1;
          sentManual += 1;
          if (recentSent.length < 5) recentSent.push(row);
        } else {
          noWebhookUrl += 1;
          if (recentNoWebhook.length < 25) recentNoWebhook.push(row);
        }
      } else if (audit.outcome === 'exception') {
        // Same coverage logic for exceptions: a manual push after an
        // auto-forward exception means Bonzo got the lead.
        if (manualPush) {
          sent += 1;
          sentManual += 1;
          if (recentSent.length < 5) recentSent.push(row);
        } else {
          exception += 1;
          if (recentExceptions.length < 25) recentExceptions.push(row);
          const key = `EXC: ${(audit.errorPreview ?? '').slice(0, 120)}`;
          errorBuckets.set(key, (errorBuckets.get(key) ?? 0) + 1);
        }
      } else if (audit.outcome === 'no_lead') {
        exception += 1;
      }
    } else if (manualPush) {
      // No auto audit, but we've got proof the admin pushed manually
      // through a Bonzo IntegrationService. Count as sent.
      forwarded += 1;
      sent += 1;
      sentManual += 1;
      if (recentSent.length < 5) recentSent.push(row);
    } else {
      neverAttempted += 1;
      if (recentNeverAttempted.length < 25) recentNeverAttempted.push(row);
    }
  }

  const topErrors = [...errorBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  return {
    lookbackDays: days,
    windowStart: since.toISOString(),
    manualBonzoServices: bonzoServices.map((s) => ({ slug: s.slug, name: s.name })),
    excludedCsvLeads,
    totals: {
      assigned: leads.length,
      forwarded,
      sent,
      sentAuto,
      sentManual,
      httpError,
      noWebhookUrl,
      exception,
      neverAttempted,
    },
    topErrors,
    recentHttpErrors,
    recentExceptions,
    recentNoWebhook,
    recentNeverAttempted,
    recentSent,
  };
}

/**
 * Returns the lead IDs whose Bonzo forward needs replay. Callers loop
 * client-side via `retryBonzoForwardForLead(leadId)` so the UI gets
 * per-row progress and we sidestep serverless function timeouts (same
 * pattern broker-launch uses).
 *
 * `bucket`:
 *   - 'failed'       -> http_error + exception
 *   - 'never'        -> assigned but no audit row at all (forward never
 *                       fired — this is the "what happened?" bucket)
 *   - 'no-webhook'   -> assigned but the LO has no bonzoWebhookUrl set
 */
export async function getBonzoForwardRetryIds(
  input: { days?: number; bucket: 'failed' | 'never' | 'no-webhook' }
): Promise<string[]> {
  await assertDistributionAdmin();
  const days = Math.max(1, Math.min(60, input.days ?? 7));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Resolve CSV vendor + Bonzo service IDs in parallel before pulling
  // leads, so we can apply both exclusions at the query layer.
  const [csvVendor, bonzoServices] = await Promise.all([
    prisma.leadVendor.findUnique({
      where: { slug: CSV_VENDOR_SLUG },
      select: { id: true },
    }),
    prisma.integrationService.findMany({
      where: { urlTemplate: { contains: 'bonzo', mode: 'insensitive' } },
      select: { id: true },
    }),
  ]);
  const csvVendorId = csvVendor?.id ?? null;

  // Same Bonzo-service detection as getBonzoForwardStatus so manual
  // pushes are excluded from the retry queue. We never want a click
  // here to double-push a lead the admin already sent themselves.
  const manualSentLeadIds = new Set<string>(
    bonzoServices.length === 0
      ? []
      : (
          await prisma.serviceDispatch.findMany({
            where: {
              serviceId: { in: bonzoServices.map((s) => s.id) },
              status: ServiceDispatchStatus.SENT,
              createdAt: { gte: since },
            },
            select: { leadId: true },
          })
        ).map((d) => d.leadId)
  );

  const leads = await prisma.lead.findMany({
    where: {
      assignedAt: { gte: since },
      // Match the panel's exclusion exactly: CSV uploads aren't actionable
      // from here, and including them in the retry queue would silently
      // push 4k+ historical imports through Bonzo on a single click.
      ...(csvVendorId ? { vendorId: { not: csvVendorId } } : {}),
    },
    select: { id: true, customData: true },
    orderBy: { assignedAt: 'asc' },
    take: 5000,
  });

  const ids: string[] = [];
  for (const lead of leads) {
    if (manualSentLeadIds.has(lead.id)) continue;
    const audit = readBonzoAudit(lead.customData);
    if (input.bucket === 'failed') {
      if (audit && (audit.outcome === 'http_error' || audit.outcome === 'exception')) {
        ids.push(lead.id);
      }
    } else if (input.bucket === 'never') {
      if (!audit) ids.push(lead.id);
    } else if (input.bucket === 'no-webhook') {
      if (audit && audit.outcome === 'no_webhook_url') ids.push(lead.id);
    }
    if (ids.length >= 500) break;
  }
  return ids;
}

export type BonzoRetryResult = {
  ok: boolean;
  message: string;
};

export async function retryBonzoForwardForLead(
  leadId: string
): Promise<BonzoRetryResult> {
  await assertDistributionAdmin();
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, assignedUserId: true },
  });
  if (!lead) return { ok: false, message: 'Lead not found.' };
  if (!lead.assignedUserId) {
    return { ok: false, message: 'Lead has no assigned user.' };
  }
  // forwardLeadToBonzo writes the audit row itself; we just trigger it
  // and trust the next status fetch to reflect the outcome.
  await forwardLeadToBonzo(leadId, lead.assignedUserId, 'manual');
  // Re-read the audit so the immediate UI feedback reflects the actual
  // outcome instead of a generic "queued" message.
  const fresh = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { customData: true },
  });
  const audit = readBonzoAudit(fresh?.customData);
  if (!audit) return { ok: false, message: 'Forward attempted but no audit found.' };
  if (audit.outcome === 'sent') {
    return { ok: true, message: `Sent (${audit.status ?? 200}).` };
  }
  return {
    ok: false,
    message: `${audit.outcome}${audit.status ? ` (${audit.status})` : ''}${audit.errorPreview ? `: ${audit.errorPreview.slice(0, 120)}` : ''}`,
  };
}
