import { prisma } from '@/lib/prisma';
import {
  coalesceMilitaryFlag,
  normalizeMilitaryFlagToBool,
} from '@/lib/militaryFlag';
import {
  withConcurrencyLimit,
  ConcurrencyKeys,
} from '@/lib/concurrencyLimit';

/**
 * Cap on simultaneous in-flight `forwardLeadToBonzo` calls.
 *
 * Each forward holds up to 2 Prisma connections at peak (the parallel
 * `userLeadQuota.findUnique` + `lead.findUnique`, then the single-query
 * audit upsert below). Without a cap, bulk paths (`bulkAssignLeads`,
 * CSV import "fire Bonzo" loop, post-distribution loop in
 * `leadActions.ts`) burst ~100 connection requests on a 50-lead batch
 * and exhaust Vercel's ~10–20 connection Prisma pool — see
 * `src/lib/concurrencyLimit.ts` for the full failure-mode write-up.
 *
 * 5 keeps Bonzo throughput high (the bottleneck is Bonzo's HTTP API,
 * not us — at 5 concurrent and ~500ms per POST that's still 10
 * leads/sec) while leaving the rest of the pool free for the rest of
 * the request cycle.
 */
const FORWARD_CONCURRENCY_LIMIT = 5;

/**
 * Single source of truth for the Bonzo forward audit record we stash on
 * `Lead.customData.lastBonzoForward`. Stored as JSON (not a dedicated
 * table) so we never need a migration to start observing Bonzo health.
 *
 * `outcome`:
 *   - 'sent'              -> Bonzo accepted the payload (HTTP 2xx)
 *   - 'http_error'        -> Bonzo responded but with a non-2xx status
 *   - 'no_webhook_url'    -> assigned user has no bonzoWebhookUrl set,
 *                            so we never tried to POST. This used to
 *                            silently no-op; now it's auditable.
 *   - 'no_lead'           -> lead disappeared between assignment and
 *                            forwarding (effectively impossible but
 *                            kept exhaustive)
 *   - 'exception'         -> network / timeout / unhandled error
 */
export type BonzoForwardAudit = {
  at: string; // ISO timestamp of the attempt
  outcome:
    | 'sent'
    | 'http_error'
    | 'no_webhook_url'
    | 'no_lead'
    | 'exception';
  status?: number;
  statusText?: string;
  errorPreview?: string;
  // `auto`   = fired during normal lead-distribution as part of the
  //            assignment chain
  // `manual` = an admin clicked "Push to Service" or "Retry" in the
  //            Health panel
  // `sweep`  = the self-healing background sweep recovered a lead that
  //            slipped through (no audit row + no manual push despite
  //            being assigned >N min ago)
  trigger?: 'auto' | 'manual' | 'sweep';
};

const MAX_BODY_PREVIEW = 500;

/**
 * Persists the audit record to `Lead.customData.lastBonzoForward` without
 * disturbing any other keys callers may have stashed there.
 *
 * Uses a single atomic UPDATE with Postgres' JSONB concat (`||`) operator
 * instead of a findUnique + JS merge + update. Two reasons:
 *
 * 1. Connection budget. The bulk-assign / CSV-import paths can fire
 *    dozens of forwards in parallel, and a single forward already burns
 *    2 connections on the parallel lead+user lookups. Halving the audit
 *    cost from 2 connections to 1 is the difference between staying
 *    under Vercel's pool ceiling and exhausting it (which surfaces as
 *    "Timed out fetching a new connection from the connection pool"
 *    exceptions in the Health panel).
 *
 * 2. Race correctness. The previous read-modify-write window meant two
 *    concurrent forwards on the same lead (e.g. an auto-forward racing
 *    a manual Push to Service retry) could each read the same baseline
 *    customData, append their own audit, and the later writer would
 *    clobber the earlier one's other-key changes. The `||` merge lets
 *    Postgres serialize the merge atomically.
 *
 * Audit writes use a one-shot retry with a short backoff: the
 * connection-pool exception we're trying to record could be the same
 * transient blip that takes down the audit write, and silently losing
 * the audit row is exactly what made "never_attempted" balloon to 184
 * leads in the first place. Two attempts is the right tradeoff —
 * enough to ride out a pool burp without holding the assignment chain
 * indefinitely.
 */
async function recordBonzoForwardAudit(
  leadId: string,
  audit: BonzoForwardAudit
): Promise<void> {
  const auditJson = JSON.stringify(audit);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await prisma.$executeRaw`
        UPDATE "Lead"
        SET "customData" = COALESCE("customData", '{}'::jsonb)
                        || jsonb_build_object('lastBonzoForward', ${auditJson}::jsonb)
        WHERE "id" = ${leadId}
      `;
      return;
    } catch (err) {
      if (attempt === 0) {
        // Most likely cause is the connection-pool burp that the audit
        // is trying to capture. Wait briefly and try once more so the
        // actual outcome makes it onto the lead instead of leaving the
        // row in a phantom "never attempted" state.
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      console.warn(
        `[bonzo] Failed to write forward audit for lead ${leadId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

/**
 * Forwards a newly-assigned lead to the assigned user's Bonzo webhook URL.
 * Fire-and-forget: any failure is logged but never bubbles up to the caller,
 * so Bonzo outages never block lead distribution.
 *
 * Every call writes a `BonzoForwardAudit` to `Lead.customData.lastBonzoForward`
 * so the Lead Distribution Health page has authoritative data on whether
 * Bonzo received each lead. HTTP errors (4xx/5xx) are now recorded as
 * `http_error` rather than swallowed silently.
 */
export async function forwardLeadToBonzo(
  leadId: string,
  userId: string,
  trigger: 'auto' | 'manual' | 'sweep' = 'auto'
): Promise<void> {
  // Gate every forward through the global concurrency limit so a 50-
  // lead bulk assignment can't exhaust the Prisma connection pool. The
  // semaphore queues callers internally, so callers still get the
  // fire-and-forget contract — they just complete in waves rather than
  // all at once. See FORWARD_CONCURRENCY_LIMIT for the rationale.
  return withConcurrencyLimit(
    ConcurrencyKeys.bonzoForward,
    FORWARD_CONCURRENCY_LIMIT,
    () => forwardLeadToBonzoImpl(leadId, userId, trigger)
  );
}

async function forwardLeadToBonzoImpl(
  leadId: string,
  userId: string,
  trigger: 'auto' | 'manual' | 'sweep'
): Promise<void> {
  const at = new Date().toISOString();

  try {
    const [user, lead] = await Promise.all([
      prisma.userLeadQuota.findUnique({
        where: { userId },
        select: { bonzoWebhookUrl: true },
      }),
      prisma.lead.findUnique({
        where: { id: leadId },
        include: {
          vendor: { select: { name: true, slug: true } },
          campaign: { select: { name: true, routingTag: true } },
          assignedUser: { select: { name: true, email: true } },
          notes: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: { content: true, createdAt: true },
          },
        },
      }),
    ]);

    const url = user?.bonzoWebhookUrl?.trim();
    if (!url) {
      await recordBonzoForwardAudit(leadId, {
        at,
        outcome: 'no_webhook_url',
        trigger,
      });
      return;
    }
    if (!lead) {
      await recordBonzoForwardAudit(leadId, {
        at,
        outcome: 'no_lead',
        trigger,
      });
      return;
    }

    const payload = buildBonzoPayload(lead);

    try {
      const result = await postBonzoPayload(url, payload);
      if (result.ok) {
        await recordBonzoForwardAudit(leadId, {
          at,
          outcome: 'sent',
          status: result.status,
          statusText: result.statusText,
          trigger,
        });
      } else {
        // HTTP-but-not-OK: Bonzo received the request and rejected it.
        // Common causes: missing required field, invalid token in URL,
        // tenant disabled. Surface the first 500 chars of the body so
        // admins can read the actual reason on the Health page.
        await recordBonzoForwardAudit(leadId, {
          at,
          outcome: 'http_error',
          status: result.status,
          statusText: result.statusText,
          errorPreview: result.bodyExcerpt.slice(0, MAX_BODY_PREVIEW),
          trigger,
        });
        console.warn(
          `[bonzo] HTTP ${result.status} for lead ${leadId} -> user ${userId}: ${result.bodyExcerpt}`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordBonzoForwardAudit(leadId, {
        at,
        outcome: 'exception',
        errorPreview: message.slice(0, MAX_BODY_PREVIEW),
        trigger,
      });
      console.warn(
        `[bonzo] Forward error for lead ${leadId} -> user ${userId}:`,
        err
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordBonzoForwardAudit(leadId, {
      at,
      outcome: 'exception',
      errorPreview: message.slice(0, MAX_BODY_PREVIEW),
      trigger,
    });
    console.warn(
      `[bonzo] Forward error for lead ${leadId} -> user ${userId}:`,
      err
    );
  }
}

/**
 * Low-level POST to a Bonzo webhook URL. 10s timeout, JSON body, standard UA.
 * Throws on network errors; returns a structured result on HTTP completion
 * so callers (e.g. the admin "Send test" action) can surface status/body.
 */
export async function postBonzoPayload(
  url: string,
  payload: unknown
): Promise<{ ok: boolean; status: number; statusText: string; bodyExcerpt: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FFL-Portal/1.0 (+lead-distribution)',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Cap the body we read so a large HTML error page doesn't blow up memory
    // or the server-action response size.
    const raw = await res.text().catch(() => '');
    const bodyExcerpt = raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      bodyExcerpt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

type LeadLike = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  homePhone: string | null;
  workPhone: string | null;
  dob: string | null;
  ssn: string | null;
  coFirstName: string | null;
  coLastName: string | null;
  coEmail: string | null;
  coPhone: string | null;
  coHomePhone: string | null;
  coWorkPhone: string | null;
  coDob: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  mailingCounty: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyCounty: string | null;
  purchasePrice: string | null;
  propertyValue: string | null;
  propertyType: string | null;
  propertyUse: string | null;
  propertyAcquired: string | null;
  propertyLtv: string | null;
  employer: string | null;
  jobTitle: string | null;
  employmentLength: string | null;
  selfEmployed: string | null;
  income: string | null;
  bankruptcy: string | null;
  foreclosure: string | null;
  homeowner: string | null;
  coEmployer: string | null;
  coJobTitle: string | null;
  coEmploymentLength: string | null;
  coSelfEmployed: string | null;
  coIncome: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  loanTerm: string | null;
  loanType: string | null;
  loanRate: string | null;
  downPayment: string | null;
  cashOut: string | null;
  creditRating: string | null;
  currentLender: string | null;
  currentBalance: string | null;
  currentRate: string | null;
  currentPayment: string | null;
  currentTerm: string | null;
  currentType: string | null;
  otherBalance: string | null;
  otherPayment: string | null;
  targetRate: string | null;
  vaStatus: string | null;
  vaLoan: string | null;
  isMilitary: string | null;
  fhaLoan: string | null;
  sourceUrl: string | null;
  leadCreated: string | null;
  price: string | null;
  status: string;
  assignedAt: Date | null;
  receivedAt: Date;
  vendor: { name: string; slug: string };
  campaign: { name: string; routingTag: string } | null;
  assignedUser: { name: string; email: string } | null;
  notes?: Array<{ content: string; createdAt: Date }>;
};

/**
 * Builds the JSON body we POST to a Bonzo webhook URL.
 *
 * Field names follow Bonzo's public "Create Prospect in Campaign" schema
 * (verified against both the proven LeadMailbox -> Bonzo service one of
 * our admins built, and Bonzo's Zapier integration catalog). Keep this in
 * sync with docs/lead-mailbox-service-setup.md whenever Bonzo updates
 * their accepted keys.
 *
 * Source-of-truth mapping (Lead field -> Bonzo key):
 *
 *   id                  -> lead_id
 *   firstName/lastName  -> first_name / last_name
 *   email               -> email
 *   phone               -> phone (falls back to homePhone, then workPhone — see
 *                          the comment on `primaryPhone` below for why)
 *   homePhone           -> home_phone
 *   workPhone           -> work_phone
 *   dob                 -> birthday
 *   ssn                 -> ssn
 *   mailingAddress/...  -> address / city / state / zip     (borrower mailing;
 *                          falls back to propertyAddress/... so LMB-sourced
 *                          leads — whose bridge writes every address variant
 *                          into the property* columns — still populate
 *                          Bonzo's native address keys)
 *   propertyAddress/... -> property_address / property_city / property_state / property_zip / property_county
 *   propertyType        -> property_type
 *   propertyUse         -> property_use
 *   propertyValue       -> property_value
 *   purchasePrice       -> purchase_price
 *   loanPurpose         -> loan_purpose
 *   loanAmount          -> loan_amount
 *   loanType            -> loan_type
 *   loanTerm            -> loan_program AND loan_term (mirrored — Bonzo
 *                          tenants vary on which key their campaign triggers
 *                          read, so we send both to avoid silently breaking
 *                          either configuration)
 *   currentBalance      -> loan_balance
 *   currentRate         -> interest_rate
 *   downPayment         -> down_payment
 *   cashOut             -> cash_out_amount
 *   creditRating        -> credit_score
 *   bankruptcy          -> bankruptcy_details
 *   foreclosure         -> foreclosure_details
 *   isMilitary          -> veteran (Bonzo-native boolean, drives VA
 *                          campaigns). Sent as a real `true`/`false`/`null`
 *                          JSON value — Bonzo's boolean-strict triggers
 *                          ignore the string "True"/"Yes". Normalized
 *                          through src/lib/militaryFlag.ts so every
 *                          vendor's shape ("True"/"Yes"/"1"/etc.)
 *                          resolves the same way. Also mirrored to
 *                          custom_ismilitary + custom_veteran as
 *                          "Yes"/"No" strings for admins whose existing
 *                          Bonzo triggers are keyed on the legacy LMB
 *                          field names. Falls back to vaStatus when
 *                          isMilitary is null or empty.
 *   employer            -> prospect_company, company_name
 *   jobTitle            -> occupation
 *   income              -> income, household_income
 *   coFirstName/...     -> co_first_name / co_last_name / co_email
 *   coPhone             -> co_phone (falls back to coHomePhone, then
 *                          coWorkPhone — same reason as borrower phone)
 *   coHomePhone         -> co_home_phone
 *   coWorkPhone         -> co_work_phone
 *   coDob               -> co_birthday
 *   campaign.name       -> lead_source
 *   receivedAt (UTC)    -> application_date (YYYY-MM-DD)
 *   status              -> 1_Status
 *   notes + meta        -> notes (array)
 *
 * Fields we deliberately skip (Bonzo doesn't have a matching key): LTV,
 * otherBalance, otherPayment, targetRate, vaLoan, fhaLoan, currentLender,
 * currentPayment, currentTerm, currentType, propertyAcquired, homeowner,
 * sourceUrl. If you need any of these in Bonzo later, promote them to
 * `field_1`..`field_5` (Bonzo's custom text slots) here.
 *
 * user_id is intentionally omitted: each LO uses their own Bonzo webhook
 * URL, which identifies the destination sub-user on Bonzo's side.
 */
function buildBonzoPayload(lead: LeadLike) {
  const applicationDate = toYmd(lead.receivedAt);
  const notes = buildNotesArray(lead);

  // Derive a canonical veteran signal once, then project it into the three
  // keys Bonzo and its legacy-LMB users expect:
  //   - `veteran`:           real JS boolean for Bonzo's native field, so
  //                          campaign conditionals like `veteran == true`
  //                          fire reliably regardless of what the source
  //                          vendor sent ("True", "Yes", "1", etc.).
  //   - `custom_ismilitary`: "Yes"/"No" string for LMB-era triggers that
  //                          were built before Bonzo added the native key.
  //   - `custom_veteran`:    same "Yes"/"No" mirror, keyed the way some
  //                          admins prefer for their custom workflows.
  // `coalesceMilitaryFlag` also guards against empty-string values (which
  // LM substitutes when the source field is blank) — plain `??` would
  // keep the empty string and leave Bonzo seeing `veteran: ""`.
  const veteranFlag = coalesceMilitaryFlag(lead.isMilitary, lead.vaStatus);
  const veteranBool = normalizeMilitaryFlagToBool(veteranFlag);
  const veteranYesNo = veteranFlag; // 'Yes' | 'No' | null

  // Mailing address falls back to property-*. Bonzo's native `address` /
  // `city` / `state` / `zip` keys drive most campaign triggers, so leaving
  // them null (even when `property_address` was populated) meant LOs' VA
  // / refinance campaigns couldn't match on city/state. The fallback
  // covers two distinct cases:
  //   1. Vendors that only ever send a single address (most non-LMB vendors
  //      and the bulk of LMB-sourced leads): the value lands on `property*`
  //      and Bonzo's borrower address block fills from the fallback.
  //   2. Investor leads with a genuinely different mailing vs subject
  //      property: `mailing*` is set explicitly by the LMB bridge map and
  //      wins, exactly like Bonzo wants for the borrower block.
  // Same `??` pattern the Broker Launch email uses for its `Address = …`
  // block.
  const mailAddress = lead.mailingAddress ?? lead.propertyAddress;
  const mailCity = lead.mailingCity ?? lead.propertyCity;
  const mailState = lead.mailingState ?? lead.propertyState;
  const mailZip = lead.mailingZip ?? lead.propertyZip;

  // Bonzo's `phone` is the primary number every campaign trigger keys off.
  // Vendors don't agree on which slot the borrower's reachable number lands
  // in: FreeRateUpdate's LMB template (see leadMailboxBridge.ts) routes
  // `{phonenumeric}` -> `number1` -> `Lead.phone` but `{HomePhone}` ->
  // `number2` -> `Lead.homePhone`, and FRU often supplies only one of the
  // two. Without a fallback, Bonzo received `phone: null` for every FRU
  // lead whose only number was a home phone — VA / refi triggers wouldn't
  // fire and LOs had no way to call them. Fall through homePhone -> workPhone
  // so Bonzo always gets the best available number, and still emit the
  // distinct `home_phone` / `work_phone` keys below for tenants whose
  // workflows key off those instead.
  const primaryPhone = lead.phone ?? lead.homePhone ?? lead.workPhone;
  const primaryCoPhone = lead.coPhone ?? lead.coHomePhone ?? lead.coWorkPhone;

  return {
    // Identity
    lead_id: lead.id,
    lead_source: lead.campaign?.name ?? lead.vendor.name,
    application_date: applicationDate,
    '1_Status': lead.status,

    // Borrower contact
    first_name: lead.firstName,
    last_name: lead.lastName,
    email: lead.email,
    phone: primaryPhone,
    home_phone: lead.homePhone,
    work_phone: lead.workPhone,
    birthday: lead.dob,
    ssn: lead.ssn,

    // Borrower mailing address
    address: mailAddress,
    city: mailCity,
    state: mailState,
    zip: mailZip,

    // Property address
    property_address: lead.propertyAddress,
    property_city: lead.propertyCity,
    property_state: lead.propertyState,
    property_zip: lead.propertyZip,
    property_county: lead.propertyCounty,

    // Property details
    property_type: lead.propertyType,
    property_use: lead.propertyUse,
    property_value: lead.propertyValue,
    purchase_price: lead.purchasePrice,

    // Loan
    loan_purpose: lead.loanPurpose,
    loan_amount: lead.loanAmount,
    loan_type: lead.loanType,
    loan_program: lead.loanTerm,
    // Mirror loanTerm onto Bonzo's `loan_term` key as well. Some tenants
    // configured campaigns against `loan_program` (the original mapping)
    // and others against `loan_term`; sending both prevents silent
    // mismatches without forcing every admin to re-key their triggers.
    loan_term: lead.loanTerm,
    loan_balance: lead.currentBalance,
    interest_rate: lead.currentRate,
    down_payment: lead.downPayment,
    cash_out_amount: lead.cashOut,
    credit_score: lead.creditRating,

    // Bonzo-native risk / custom flags (match the LMB sample exactly)
    bankruptcy_details: lead.bankruptcy,
    foreclosure_details: lead.foreclosure,
    // Bonzo's first-class "Veteran" field is a real boolean in their
    // "Create Prospect" API. LOs run VA-loan campaigns off this, so the
    // boolean form is required — sending the string "True" or "Yes"
    // silently fails boolean-strict triggers. Falls back to vaStatus
    // when isMilitary is absent, and to `null` if neither is known
    // (prevents defaulting a lead to "not a veteran" on missing data,
    // which would suppress a legitimately eligible borrower).
    veteran: veteranBool,
    custom_ismilitary: veteranYesNo,
    custom_veteran: veteranYesNo,

    // Employment / company
    prospect_company: lead.employer,
    company_name: lead.employer,
    occupation: lead.jobTitle,
    income: lead.income,
    household_income: lead.income,

    // Co-borrower
    co_first_name: lead.coFirstName,
    co_last_name: lead.coLastName,
    co_email: lead.coEmail,
    co_phone: primaryCoPhone,
    co_home_phone: lead.coHomePhone,
    co_work_phone: lead.coWorkPhone,
    co_birthday: lead.coDob,

    // Notes - array of strings per Bonzo's public API (proven in the LMB
    // sample). First line documents the source, subsequent lines add the
    // routing breadcrumbs and any lead notes captured in the portal.
    notes,
  };
}

// Converts a Date to YYYY-MM-DD in UTC, matching how LMB's {createddash}
// token formats the application_date field.
function toYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildNotesArray(lead: LeadLike): string[] {
  const notes: string[] = ['From FFL Portal'];
  notes.push(`Vendor: ${lead.vendor.name}`);
  if (lead.campaign) {
    notes.push(
      `Campaign: ${lead.campaign.name} (routing_tag: ${lead.campaign.routingTag})`
    );
  }
  if (lead.assignedUser) {
    notes.push(
      `Assigned LO: ${lead.assignedUser.name} <${lead.assignedUser.email}>`
    );
  }
  if (lead.price) notes.push(`Lead price: ${lead.price}`);
  if (lead.sourceUrl) notes.push(`Source URL: ${lead.sourceUrl}`);
  if (lead.propertyLtv) notes.push(`LTV: ${lead.propertyLtv}`);
  if (lead.loanTerm) notes.push(`Loan term: ${lead.loanTerm}`);
  if (lead.notes?.length) {
    for (const n of lead.notes) {
      if (n.content?.trim()) notes.push(n.content.trim());
    }
  }
  return notes;
}

// Exported for the admin "Send test" server action, which needs to build
// a payload from a synthetic lead to validate a user's Bonzo URL.
export { buildBonzoPayload };
export type { LeadLike as BonzoLeadLike };
