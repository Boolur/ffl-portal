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
  ssn: 'ssn',

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
  down_payment: 'downPayment',
  cash_out: 'cashOut',
  credit_rating: 'creditRating',
  current_lender: 'currentLender',
  current_balance: 'currentBalance',
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
  fha_loan: 'fhaLoan',
  source_url: 'sourceUrl',

  // Vendor-provided meta
  lead_created: 'leadCreated',
  created: 'leadCreated',
  price: 'price',
  lead_price: 'price',
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
 *
 * Users paste this into each Service, then fill in `routing_tag` with the
 * portal campaign's routing tag. Unused lines can be removed safely; missing
 * fields simply don't get set. Any placeholder LM doesn't recognize passes
 * through as its literal {Token} string and is filtered out by the bridge.
 */
export function buildLeadMailboxJsonTemplate(): string {
  return JSON.stringify(
    {
      lead_id: '{LeadID}',
      routing_tag: '',

      first_name: '{FirstName}',
      last_name: '{LastName}',
      email: '{Email}',
      number1: '{MobilePhone}',
      number2: '{HomePhone}',
      number3: '{WorkPhone}',

      street: '{Mail_Address}',
      city: '{Mail_City}',
      state: '{Mail_State}',
      zip: '{Mail_Zip}',

      property_value: '{Field_007}',
      property_type: '{Field_008}',
      property_use: '{Field_009}',
      property_ltv: '{Field_011}',

      loan_amount: '{Field_036}',
      loan_rate: '{Field_037}',
      loan_term: '{Field_038}',
      cash_out: '{Field_039}',

      credit_rating: '{Field_041}',
      current_balance: '{Field_044}',
      current_payment: '{Field_045}',
      current_rate: '{Field_046}',
    },
    null,
    2
  );
}
