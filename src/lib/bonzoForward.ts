import { prisma } from '@/lib/prisma';

/**
 * Forwards a newly-assigned lead to the assigned user's Bonzo webhook URL.
 * Fire-and-forget: any failure is logged but never bubbles up to the caller,
 * so Bonzo outages never block lead distribution.
 */
export async function forwardLeadToBonzo(leadId: string, userId: string): Promise<void> {
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
    if (!url) return;
    if (!lead) return;

    const payload = buildBonzoPayload(lead);

    await postBonzoPayload(url, payload).catch((err) => {
      console.warn(`[bonzo] Forward error for lead ${leadId} -> user ${userId}:`, err);
    });
  } catch (err) {
    console.warn(`[bonzo] Forward error for lead ${leadId} -> user ${userId}:`, err);
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
 *   email / phone       -> email / phone
 *   workPhone           -> work_phone
 *   dob                 -> birthday
 *   ssn                 -> ssn
 *   mailingAddress/...  -> address / city / state / zip     (borrower mailing)
 *   propertyAddress/... -> property_address / property_city / property_state / property_zip / property_county
 *   propertyType        -> property_type
 *   propertyUse         -> property_use
 *   propertyValue       -> property_value
 *   purchasePrice       -> purchase_price
 *   loanPurpose         -> loan_purpose
 *   loanAmount          -> loan_amount
 *   loanType            -> loan_type
 *   loanTerm            -> loan_program
 *   currentBalance      -> loan_balance
 *   currentRate         -> interest_rate
 *   downPayment         -> down_payment
 *   cashOut             -> cash_out_amount
 *   creditRating        -> credit_score
 *   bankruptcy          -> bankruptcy_details
 *   foreclosure         -> foreclosure_details
 *   isMilitary          -> veteran (Bonzo-native, drives VA campaigns)
 *                          also mirrored to custom_ismilitary + custom_veteran
 *                          for admins whose existing Bonzo triggers are keyed
 *                          on the legacy LMB field names. Falls back to
 *                          vaStatus when isMilitary is null.
 *   employer            -> prospect_company, company_name
 *   jobTitle            -> occupation
 *   income              -> income, household_income
 *   coFirstName/...     -> co_first_name / co_last_name / co_email / co_phone
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
    phone: lead.phone,
    work_phone: lead.workPhone,
    birthday: lead.dob,
    ssn: lead.ssn,

    // Borrower mailing address
    address: lead.mailingAddress,
    city: lead.mailingCity,
    state: lead.mailingState,
    zip: lead.mailingZip,

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
    loan_balance: lead.currentBalance,
    interest_rate: lead.currentRate,
    down_payment: lead.downPayment,
    cash_out_amount: lead.cashOut,
    credit_score: lead.creditRating,

    // Bonzo-native risk / custom flags (match the LMB sample exactly)
    bankruptcy_details: lead.bankruptcy,
    foreclosure_details: lead.foreclosure,
    // Bonzo's first-class "Veteran" field. LOs run VA-loan campaigns off
    // this, so we populate it from the portal's Is Military flag (the
    // same yes/no that vendors post as isMilitary). Falls back to vaStatus
    // if the vendor only sends the VA-eligibility flag. Keep the custom_*
    // mirrors for admins whose existing Bonzo triggers are keyed on the
    // legacy LMB field names.
    veteran: lead.isMilitary ?? lead.vaStatus,
    custom_ismilitary: lead.isMilitary,
    custom_veteran: lead.isMilitary ?? lead.vaStatus,

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
    co_phone: lead.coPhone,
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
