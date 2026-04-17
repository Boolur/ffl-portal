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
        },
      }),
    ]);

    const url = user?.bonzoWebhookUrl?.trim();
    if (!url) return;
    if (!lead) return;

    const payload = buildBonzoPayload(lead);

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

      if (!res.ok) {
        console.warn(
          `[bonzo] Forward failed for lead ${leadId} -> user ${userId}: ${res.status} ${res.statusText}`
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn(`[bonzo] Forward error for lead ${leadId} -> user ${userId}:`, err);
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
};

function buildBonzoPayload(lead: LeadLike) {
  return {
    // Identifiers
    lead_id: lead.id,

    // Borrower contact
    first_name: lead.firstName,
    last_name: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    home_phone: lead.homePhone,
    work_phone: lead.workPhone,
    dob: lead.dob,
    ssn: lead.ssn,

    // Co-borrower
    co_first_name: lead.coFirstName,
    co_last_name: lead.coLastName,
    co_email: lead.coEmail,
    co_phone: lead.coPhone,
    co_home_phone: lead.coHomePhone,
    co_work_phone: lead.coWorkPhone,
    co_dob: lead.coDob,

    // Address (property)
    address: lead.propertyAddress,
    city: lead.propertyCity,
    state: lead.propertyState,
    zip: lead.propertyZip,
    county: lead.propertyCounty,

    // Property details
    purchase_price: lead.purchasePrice,
    property_value: lead.propertyValue,
    property_type: lead.propertyType,
    property_use: lead.propertyUse,
    property_acquired: lead.propertyAcquired,
    property_ltv: lead.propertyLtv,

    // Employer (borrower)
    employer: lead.employer,
    job_title: lead.jobTitle,
    employment_length: lead.employmentLength,
    self_employed: lead.selfEmployed,
    income: lead.income,
    bankruptcy: lead.bankruptcy,
    homeowner: lead.homeowner,

    // Employer (co-borrower)
    co_employer: lead.coEmployer,
    co_job_title: lead.coJobTitle,
    co_employment_length: lead.coEmploymentLength,
    co_self_employed: lead.coSelfEmployed,
    co_income: lead.coIncome,

    // Loan
    loan_purpose: lead.loanPurpose,
    loan_amount: lead.loanAmount,
    loan_term: lead.loanTerm,
    loan_type: lead.loanType,
    loan_rate: lead.loanRate,
    down_payment: lead.downPayment,
    cash_out: lead.cashOut,
    credit_rating: lead.creditRating,
    current_lender: lead.currentLender,
    current_balance: lead.currentBalance,
    current_rate: lead.currentRate,
    current_payment: lead.currentPayment,
    current_term: lead.currentTerm,
    current_type: lead.currentType,
    other_balance: lead.otherBalance,
    other_payment: lead.otherPayment,
    target_rate: lead.targetRate,
    va_status: lead.vaStatus,
    va_loan: lead.vaLoan,
    is_military: lead.isMilitary,
    fha_loan: lead.fhaLoan,

    // Meta
    source: lead.vendor.name,
    source_slug: lead.vendor.slug,
    source_url: lead.sourceUrl,
    campaign: lead.campaign?.name ?? null,
    routing_tag: lead.campaign?.routingTag ?? null,
    lead_price: lead.price,
    lead_created: lead.leadCreated,
    status: lead.status,
    assigned_at: lead.assignedAt?.toISOString() ?? null,
    received_at: lead.receivedAt.toISOString(),
    assigned_user_name: lead.assignedUser?.name ?? null,
    assigned_user_email: lead.assignedUser?.email ?? null,
  };
}
