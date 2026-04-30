import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendEmail, type EmailSendReceipt } from '@/lib/email';

/**
 * Broker Launch Notification email.
 *
 * LOs run third-party quoting tools that parse the plain-text body of the
 * "Broker Launch Notification" email Lead Mailbox (LMB) used to send each
 * time a lead assigned to them. Those parsers are trained on LMB's exact
 * template — label spelling, trailing periods, which lines use "=" vs ":"
 * and the tokens LMB itself never substituted (e.g. `{addl_PrimaryMortgage
 * Balance}`, `{IsMilitary}`, `{VA Loan}`, `{FHA Loan}`). Any drift from
 * that output can silently break the quoting tool.
 *
 * This module recreates that template verbatim and fills the values we
 * actually have on the Lead model. Tokens LMB never substituted are kept
 * as literals so the parsers see exactly the same shape they always have.
 *
 * Firing is driven by the Integration Service row with
 * `method = EMAIL_BROKER_LAUNCH`, seeded in the
 * 20260428010100_seed_broker_launch_email_service migration. The service
 * dispatcher (src/lib/services/dispatch.ts) calls `sendBrokerLaunchEmail`
 * when it encounters that method, which means:
 *
 *   - Every ON_ASSIGN trigger fires the service (manual assign, round-
 *     robin, default-user fallback, CSV import when the admin opts in).
 *   - Admins can batch-send from the Leads screen Push to Service modal.
 *   - Every send gets a ServiceDispatch audit row (DB-level "who got
 *     emailed?" log, no Graph Mail.Read permission required).
 */

export const BROKER_LAUNCH_SUBJECT = 'Broker Launch Notification';

/**
 * Structured result returned to the service dispatcher so it can record
 * a meaningful ServiceDispatch row (SENT / SKIPPED / FAILED). Callers
 * outside the dispatcher (none today, but kept for test scripts) can
 * treat any non-`ok` response as a warning to log.
 */
export type BrokerLaunchSendResult =
  | { ok: true; info?: string; receipt: EmailSendReceipt }
  | {
      ok: false;
      skipped: true;
      reason: 'lead_not_found' | 'no_assignee' | 'no_email_on_user';
      info?: string;
    }
  | { ok: false; skipped?: false; error: string };

/**
 * Lead shape sufficient to render the broker-launch body. We accept the
 * preloaded relations from the dispatcher (which already loaded vendor,
 * campaign, and assignedUser one query earlier) so we never re-hit the
 * DB on the email path. Eliminating the duplicate `prisma.lead.findUnique`
 * was the fix for the transient "Can't reach database server" failures
 * that surfaced on the Lead Distribution Health page — Prisma queries
 * against the pooler can blip in serverless, and doing two back-to-back
 * for the same row doubled the failure rate for no upside.
 */
export type BrokerLaunchPreloadedLead = Prisma.LeadGetPayload<{
  include: {
    vendor: true;
    campaign: true;
    assignedUser: true;
  };
}>;

/**
 * Sends the Broker Launch Notification to the lead's assigned LO. Returns
 * a structured result instead of throwing so the dispatcher can map it
 * directly to a ServiceDispatch row without additional try/catch.
 *
 * Two call shapes:
 *
 *   1. Preferred: pass the preloaded `lead` (with vendor/campaign/
 *      assignedUser included) — no DB calls, just renders + Graph send.
 *      The service dispatcher always loads this exact shape for every
 *      service before deciding which transport to use, so reusing it
 *      here keeps the email path zero-query.
 *
 *   2. Fallback: pass `{ leadId, userId }` — used by test scripts and
 *      any caller that doesn't already have the lead in hand. We do
 *      load the row in this branch because we have no choice.
 */
export async function sendBrokerLaunchEmail(
  arg:
    | { lead: BrokerLaunchPreloadedLead }
    | { leadId: string; userId: string }
): Promise<BrokerLaunchSendResult> {
  const leadIdForLogging =
    'lead' in arg ? arg.lead.id : arg.leadId;
  const userIdForLogging =
    'lead' in arg ? arg.lead.assignedUserId ?? '<unassigned>' : arg.userId;

  try {
    let lead: BrokerLaunchPreloadedLead | null;
    if ('lead' in arg) {
      lead = arg.lead;
    } else {
      lead = await prisma.lead.findUnique({
        where: { id: arg.leadId },
        include: {
          vendor: true,
          campaign: true,
          assignedUser: true,
        },
      });
    }

    if (!lead) {
      return { ok: false, skipped: true, reason: 'lead_not_found' };
    }
    const assignee = lead.assignedUser;
    if (!assignee) {
      return { ok: false, skipped: true, reason: 'no_assignee' };
    }
    if (!assignee.email) {
      return {
        ok: false,
        skipped: true,
        reason: 'no_email_on_user',
        info: `User ${assignee.id} has no email on their account.`,
      };
    }

    const body = buildBrokerLaunchEmailBody({
      ...lead,
      vendor: { name: lead.vendor?.name ?? 'Unknown' },
      campaign: lead.campaign
        ? { name: lead.campaign.name, routingTag: lead.campaign.routingTag }
        : null,
    });

    const receipt = await sendEmail({
      to: assignee.email,
      subject: BROKER_LAUNCH_SUBJECT,
      text: body,
    });

    return {
      ok: true,
      info: `Accepted by Microsoft Graph (${receipt.status}) for ${assignee.email}`,
      receipt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[broker-launch] Email error for lead ${leadIdForLogging} -> user ${userIdForLogging}:`,
      err
    );
    return { ok: false, error: message };
  }
}

type BrokerLaunchLead = {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  mailingAddress: string | null;
  mailingCity: string | null;
  mailingState: string | null;
  mailingZip: string | null;
  propertyAddress: string | null;
  propertyCity: string | null;
  propertyState: string | null;
  propertyZip: string | null;
  propertyType: string | null;
  propertyUse: string | null;
  propertyValue: string | null;
  propertyLtv: string | null;
  loanPurpose: string | null;
  loanAmount: string | null;
  loanType: string | null;
  cashOut: string | null;
  creditRating: string | null;
  currentBalance: string | null;
  currentRate: string | null;
  price: string | null;
  vendor: { name: string };
  campaign: { name: string; routingTag: string } | null;
};

/**
 * Builds the exact plain-text body LMB's "Broker Launch Notification"
 * produced. Quirks preserved intentionally:
 *
 *  - `Email = …` has no trailing period (an appended "." would corrupt
 *    naive email parsers).
 *  - Numeric lines (Property Value, Current Balance, Property LTV, Cash
 *    out, Loan Amount, Price) have no trailing period — matches LMB.
 *  - `Loan Type = .`, `Purchase Agreement = .`, `Found Home = .` etc.
 *    render as "= ." when empty, same as LMB.
 *  - The five tokens LMB never substituted (`{addl_PrimaryMortgageBalance}`,
 *    `{addl_HomeEquityAddlCash}`, `{IsMilitary}`, `{VA Loan}`,
 *    `{FHA Loan}`) are preserved as literals so downstream parsers see
 *    the same shape they always have.
 *  - `curentVALoan` is intentionally misspelled — matches LMB's template.
 *  - `Current Rate:` and `DOB:` use a colon, not `=` — matches LMB.
 */
export function buildBrokerLaunchEmailBody(lead: BrokerLaunchLead): string {
  const campaignLabel =
    lead.campaign?.routingTag || lead.campaign?.name || lead.vendor.name;

  // Mailing block falls back to property-* because our Lead Mailbox bridge
  // writes every address variant into the property_* columns (see
  // leadMailboxBridge.ts). That keeps the "Address = …" section populated
  // for leads that came through the bridge, while vendors that send a
  // separate mailing address still win.
  const mailAddress = lead.mailingAddress ?? lead.propertyAddress;
  const mailCity = lead.mailingCity ?? lead.propertyCity;
  const mailState = lead.mailingState ?? lead.propertyState;
  const mailZip = lead.mailingZip ?? lead.propertyZip;

  const lines: string[] = [];
  lines.push('Broker Launch Notification');
  lines.push('');
  lines.push(`Campaign = ${period(campaignLabel)}`);
  lines.push('');
  lines.push(`First Name = ${period(lead.firstName)}`);
  lines.push(`Last Name = ${period(lead.lastName)}`);
  lines.push(`Phone = ${period(formatPhone(lead.phone))}`);
  lines.push(`Email = ${bare(lead.email)}`);
  lines.push('');
  lines.push(`Address = ${period(mailAddress)}`);
  lines.push(`City = ${period(mailCity)}`);
  lines.push(`State = ${period(mailState)}`);
  lines.push(`Zip = ${period(mailZip)}`);
  lines.push('');
  lines.push(`PhysicalAddress = ${period(lead.propertyAddress)}`);
  lines.push(`Phys City = ${period(lead.propertyCity)}`);
  lines.push(`Phys State = ${period(lead.propertyState)}`);
  lines.push(`Phys Zip = ${period(lead.propertyZip)}`);
  lines.push('');
  lines.push(`Loan Purpose = ${period(lead.loanPurpose)}`);
  lines.push(`Loan Type = ${period(lead.loanType)}`);
  lines.push(`Property Use = ${period(lead.propertyUse)}`);
  lines.push(`Property Type = ${period(lead.propertyType)}`);
  lines.push(`Credit Rating = ${period(lead.creditRating)}`);
  lines.push('CB = {addl_PrimaryMortgageBalance}');
  lines.push(`Property Value = ${bare(lead.propertyValue)}`);
  lines.push(`Current Balance = ${bare(lead.currentBalance)}`);
  lines.push(`Property LTV = ${bare(lead.propertyLtv)}`);
  lines.push('');
  lines.push(`Cash out = ${bare(lead.cashOut)}`);
  lines.push('HELOC = {addl_HomeEquityAddlCash}');
  lines.push(`Loan Amount = ${bare(lead.loanAmount)}`);
  lines.push('');
  lines.push('IsMilitary = {IsMilitary}.');
  lines.push('curentVALoan = {VA Loan}.');
  lines.push('currentFHALoan = {FHA Loan}.');
  lines.push('');
  lines.push(`Price = ${bare(lead.price)}`);
  lines.push('');
  lines.push('Purchase Agreement = .');
  lines.push('Found Home = .');
  lines.push('');
  lines.push(`Current Rate: ${bare(lead.currentRate)}`);
  lines.push(`DOB: ${bare(lead.dob)}`);

  return lines.join('\n');
}

/**
 * Renders a value with a trailing period, matching LMB's template for
 * string fields. Empty values still emit `.` so "Loan Type = ." stays
 * stable when we have no data (downstream parsers anchor on the label).
 */
function period(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed ? `${trimmed}.` : '.';
}

/**
 * Renders a value without a trailing period, matching LMB's template for
 * numeric fields, email, and the `:` lines at the end of the body. Empty
 * values emit the empty string so "Current Rate: " renders correctly.
 */
function bare(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * Normalizes a phone string to LMB's `(AAA)BBB-CCCC` layout (no space
 * between ")" and the next digit). Anything we can't parse into at least
 * 10 digits is passed through trimmed, so malformed input still shows up
 * verbatim rather than being silently dropped.
 */
function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 10) return raw.trim();
  // Drop a leading country "1" so "1 (775) 433-5675" still reformats
  // to the canonical 10-digit shape LMB emitted.
  const ten = digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits.slice(0, 10);
  return `(${ten.slice(0, 3)})${ten.slice(3, 6)}-${ten.slice(6, 10)}`;
}
