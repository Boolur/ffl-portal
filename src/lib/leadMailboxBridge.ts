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
 * Canonical JSON template for Lead Mailbox's "Content" field. Lead Mailbox
 * substitutes {Placeholder} tokens at send time, so the resulting POST body
 * matches `LEAD_MAILBOX_FIELD_MAP` exactly.
 *
 * Users paste this into each Service, then fill in the `routing_tag` with
 * the matching portal Campaign's routing tag. Unused lines can be removed
 * safely; missing fields simply don't get set.
 */
export function buildLeadMailboxJsonTemplate(): string {
  return JSON.stringify(
    {
      lead_id: '{Lead_ID}',
      routing_tag: '',
      first_name: '{FirstName}',
      last_name: '{LastName}',
      email: '{Email}',
      number1: '{MobilePhone}',
      number2: '{HomePhone}',
      number3: '{WorkPhone}',
      dob: '{DateOfBirth}',
      ssn: '{SSN}',
      co_first_name: '{CoFirstName}',
      co_last_name: '{CoLastName}',
      co_email: '{CoEmail}',
      co_phone: '{CoMobilePhone}',
      co_home_phone: '{CoHomePhone}',
      co_work_phone: '{CoWorkPhone}',
      co_dob: '{CoDateOfBirth}',
      street: '{Mail_Address}',
      city: '{Mail_City}',
      state: '{Mail_State}',
      zip: '{Mail_Zip}',
      county: '{Mail_County}',
      property_value: '{PropertyValue}',
      property_type: '{PropertyType}',
      property_use: '{PropertyUse}',
      property_acquired: '{PropertyAcquired}',
      purchase_price: '{PurchasePrice}',
      property_ltv: '{LTV}',
      employer: '{Employer}',
      job_title: '{JobTitle}',
      employment_length: '{EmploymentLength}',
      self_employed: '{SelfEmployed}',
      income: '{Income}',
      bankruptcy: '{Bankruptcy}',
      homeowner: '{Homeowner}',
      co_employer: '{CoEmployer}',
      co_job_title: '{CoJobTitle}',
      co_employment_length: '{CoEmploymentLength}',
      co_self_employed: '{CoSelfEmployed}',
      co_income: '{CoIncome}',
      loan_purpose: '{LoanPurpose}',
      loan_amount: '{LoanAmount}',
      loan_term: '{LoanTerm}',
      loan_type: '{LoanType}',
      loan_rate: '{InterestRate}',
      down_payment: '{DownPayment}',
      cash_out: '{CashOut}',
      credit_rating: '{CreditRating}',
      current_lender: '{CurrentLender}',
      current_balance: '{CurrentBalance}',
      current_rate: '{CurrentRate}',
      current_payment: '{CurrentPayment}',
      current_term: '{CurrentTerm}',
      current_type: '{CurrentType}',
      other_balance: '{OtherBalance}',
      other_payment: '{OtherPayment}',
      target_rate: '{TargetRate}',
      va_status: '{VAStatus}',
      va_loan: '{VALoan}',
      is_military: '{Military}',
      fha_loan: '{FHALoan}',
      source_url: '{SourceURL}',
      lead_created: '{LeadCreated}',
      price: '{LeadPrice}',
    },
    null,
    2
  );
}
