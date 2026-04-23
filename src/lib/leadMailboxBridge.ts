/**
 * Lead Mailbox Bridge helpers.
 *
 * The portal exposes POST /api/webhooks/lead-mailbox/<vendorSlug> so that
 * Lead Mailbox "Services" can forward leads into the new distribution
 * pipeline during the cutover period. Since Lead Mailbox already normalizes
 * every source vendor into its own field names, we use a fixed map here
 * rather than each vendor's configurable `fieldMapping` (which stays
 * reserved for the eventual direct integration).
 */

/**
 * Lead Mailbox payload key -> portal Lead field.
 *
 * Keys on the left are what the bridge endpoint expects to receive in the
 * JSON body. Values on the right are scalar column names on the `Lead`
 * model in prisma/schema.prisma.
 */
export const LEAD_MAILBOX_FIELD_MAP: Record<string, string> = {
  // Borrower contact
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  number1: 'phone',
  phone: 'phone',
  mobile: 'phone',
  number2: 'homePhone',
  home_phone: 'homePhone',
  number3: 'workPhone',
  work_phone: 'workPhone',
  dob: 'dob',
  date_of_birth: 'dob',
  birthday: 'dob',
  ssn: 'ssn',
  social: 'ssn',

  // Co-borrower contact
  co_first_name: 'coFirstName',
  co_last_name: 'coLastName',
  co_email: 'coEmail',
  co_phone: 'coPhone',
  co_home_phone: 'coHomePhone',
  co_work_phone: 'coWorkPhone',
  co_dob: 'coDob',

  // Property address (mailing fields from LM also go here per the unified
  // address model the portal adopted)
  street: 'propertyAddress',
  address: 'propertyAddress',
  property_address: 'propertyAddress',
  mailing_address: 'propertyAddress',
  city: 'propertyCity',
  property_city: 'propertyCity',
  mailing_city: 'propertyCity',
  state: 'propertyState',
  property_state: 'propertyState',
  mailing_state: 'propertyState',
  zip: 'propertyZip',
  property_zip: 'propertyZip',
  mailing_zip: 'propertyZip',
  county: 'propertyCounty',
  property_county: 'propertyCounty',
  mailing_county: 'propertyCounty',

  // Physical / property address aliases (LM emits {phys_*} placeholders).
  // These take precedence over the mail_* aliases above when both are
  // supplied, because callers list property_* keys first in the canonical
  // template (see buildLeadMailboxJsonTemplate) and the bridge uses
  // first-match-wins for any target field.
  phys_address: 'propertyAddress',
  phys_city: 'propertyCity',
  phys_state: 'propertyState',
  phys_zip: 'propertyZip',
  phys_county: 'propertyCounty',

  // Property details
  purchase_price: 'purchasePrice',
  property_value: 'propertyValue',
  property_type: 'propertyType',
  property_use: 'propertyUse',
  property_acquired: 'propertyAcquired',
  property_ltv: 'propertyLtv',

  // Employer (borrower)
  employer: 'employer',
  job_title: 'jobTitle',
  employment_length: 'employmentLength',
  self_employed: 'selfEmployed',
  income: 'income',
  bankruptcy: 'bankruptcy',
  bankruptcy_details: 'bankruptcy',
  foreclosure: 'foreclosure',
  foreclosure_details: 'foreclosure',
  homeowner: 'homeowner',

  // Employer (co-borrower)
  co_employer: 'coEmployer',
  co_job_title: 'coJobTitle',
  co_employment_length: 'coEmploymentLength',
  co_self_employed: 'coSelfEmployed',
  co_income: 'coIncome',

  // Loan
  loan_purpose: 'loanPurpose',
  loan_amount: 'loanAmount',
  loan_term: 'loanTerm',
  loan_type: 'loanType',
  loan_rate: 'loanRate',
  interest_rate: 'loanRate',
  down_payment: 'downPayment',
  cash_out: 'cashOut',
  cash_out_amount: 'cashOut',
  credit_rating: 'creditRating',
  credit_score: 'creditRating',
  current_lender: 'currentLender',
  current_balance: 'currentBalance',
  loan_balance: 'currentBalance',
  current_rate: 'currentRate',
  current_payment: 'currentPayment',
  current_term: 'currentTerm',
  current_type: 'currentType',
  other_balance: 'otherBalance',
  other_payment: 'otherPayment',
  target_rate: 'targetRate',
  va_status: 'vaStatus',
  va_loan: 'vaLoan',
  is_military: 'isMilitary',
  custom_ismilitary: 'isMilitary',
  // Veteran status is tracked on the same yes/no column as isMilitary
  // (per product decision — we don't have a separate Lead.veteran field).
  veteran: 'isMilitary',
  custom_veteran: 'isMilitary',
  fha_loan: 'fhaLoan',
  source_url: 'sourceUrl',

  // Vendor-provided meta
  lead_created: 'leadCreated',
  created: 'leadCreated',
  price: 'price',
  lead_price: 'price',

  // Lead Mailbox cross-reference IDs. These aren't editable lead data —
  // they're the IDs LM assigns so the portal can link back to LM's record
  // for audit / reconciliation when a vendor reports an issue.
  user_id: 'vendorUserId',
  lm_user_id: 'vendorUserId',
  mailbox_user_id: 'vendorUserId',
};

/**
 * Lead column names that `LEAD_MAILBOX_FIELD_MAP` can write to. Used by the
 * bridge endpoint to validate field targets before writing.
 */
export const LEAD_MAILBOX_TARGET_FIELDS: Set<string> = new Set(
  Object.values(LEAD_MAILBOX_FIELD_MAP)
);

/**
 * Canonical JSON template for Lead Mailbox's "Content" field. Mirrors the
 * placeholder scheme proven to resolve correctly in this org's LM instance:
 *
 * - Standard contact + address fields use named placeholders ({FirstName},
 *   {Mail_Address}, etc.).
 * - Lead identifier is `{LeadID}` (no underscore).
 * - Property, loan, and credit details are NOT exposed as named placeholders
 *   in this LM config — they come through as numbered custom fields
 *   ({Field_007}, {Field_041}, etc.) whose IDs are assigned per-customer in
 *   LM's admin. The numbers below match the mapping in use today; if the LM
 *   admin renumbers a field, update it here and the Copy JSON Template button
 *   will hand out the corrected version.
 * - The `notes` array enriches the persisted lead with LO assignment
 *   metadata and the LM campaign name. Those placeholders have no
 *   column on the `Lead` model, but `extractBridgeNotes` preserves them
 *   as notes and filters out any tokens LM doesn't substitute.
 *
 * Users paste this into each Service, then fill in `routing_tag` with the
 * portal campaign's routing tag. Unused lines can be removed safely; missing
 * fields simply don't get set. Any placeholder LM doesn't recognize passes
 * through as its literal {Token} string and is filtered out by the bridge.
 *
 * Keep this in sync with `docs/lead-mailbox-service-setup.md` section 1.
 */
export function buildLeadMailboxJsonTemplate(): string {
  return JSON.stringify(
    {
      lead_id: '{leadid}',
      routing_tag: '',

      first_name: '{firstname}',
      last_name: '{lastname}',
      email: '{email}',
      number1: '{phonenumeric}',
      number2: '{HomePhone}',
      number3: '{WorkPhone}',
      dob: '{dob}',
      ssn: '{social}',

      property_address: '{phys_address}',
      property_city: '{phys_city}',
      property_state: '{phys_state}',
      property_zip: '{phys_zip}',
      property_county: '{phys_county}',

      property_value: '{property value}',
      property_type: '{property type}',
      property_use: '{property use}',
      purchase_price: '{purchase price}',
      property_ltv: '{Field_011}',

      employer: '{employer}',
      bankruptcy: '{bankruptcy}',
      foreclosure: '{foreclosure}',
      is_military: '{Ismilitary}',
      custom_veteran: '{Veteran}',

      loan_purpose: '{loan purpose}',
      loan_amount: '{loan amount}',
      loan_term: '{loan term}',
      loan_type: '{loan type}',
      loan_rate: '{Field_037}',
      down_payment: '{down payment}',
      cash_out: '{cash out}',

      credit_rating: '{credit rating}',
      current_balance: '{current balance}',
      current_payment: '{current payment}',
      current_rate: '{current rate}',

      lead_created: '{createddash}',
      user_id: '{user_002}',

      notes: [
        'From Lead Mailbox',
        'Assigned LO: {User_Name} ({User_Email}) NMLS {User_License} — {User_Phone}',
        'Source campaign: {campaign_name}',
        '{lastnote}',
      ],
    },
    null,
    2
  );
}

/**
 * Pulls vendor-supplied note strings out of a Lead Mailbox payload.
 *
 * Accepts any of:
 *   - `notes`: string or string[]
 *   - `vendor_notes`: string or string[]
 *   - `lastnote` / `last_note`: string
 *
 * Filters out empty strings and unsubstituted `{Placeholder}` tokens so we
 * never persist literal template text as a note. Also de-duplicates within
 * a single payload.
 */
const UNSUBSTITUTED_PLACEHOLDER_NOTE = /^\{[A-Za-z0-9_ ]+\}$/;

export function extractBridgeNotes(payload: Record<string, unknown>): string[] {
  const collected: string[] = [];

  const push = (v: unknown) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      for (const item of v) push(item);
      return;
    }
    const s = String(v).trim();
    if (!s) return;
    if (UNSUBSTITUTED_PLACEHOLDER_NOTE.test(s)) return;
    collected.push(s);
  };

  push(payload.notes);
  push(payload.vendor_notes);
  push(payload.lastnote);
  push(payload.last_note);

  const seen = new Set<string>();
  return collected.filter((n) => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}
