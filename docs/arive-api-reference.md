# Arive API reference for the FFL Portal

Reviewed 2026-10-12 from the authenticated **ARIVE Enterprise Private API v1.0** reference in Chrome. This is a working knowledge base for future integration discussions. It covers every endpoint exposed in that reference: **29 operations — 1 authentication, 18 loan, 5 lead, 2 user, and 3 hook operations** — plus the Overview page, expanded nested schemas, and all documented HTTP response tabs.

Source entry point: <https://fedfirst.myarive.com/app/user/edit/api-integration?tab=2#reference>. Open **Direct API Integration → API Reference Documentation**, then choose the operation by its exact heading below. The documentation uses internal `/operations/...` routes inside a modal; those are not API URLs and may not be standalone navigable documentation links.

API server: `https://gwapiconnect.myarive.com`. Paths below include `/api`. Findings describe the documentation visible on this date, not every private capability Arive might offer to other customers. No API requests were sent, no loans or leads were queried, no subscriptions were created, and no credentials or client records are stored here. Access to documentation does not establish that this account is provisioned for every operation.

## Findings to retain before brainstorming

- Arive offers rich loan reads: borrowers, property, financing, loan team, statuses and history, key dates, rate locks, revenue, employment, business contacts, payments, documents, notes, fees, credit scores, REO, custom fields, and trackers.
- Existing loan writes are narrow: **Update Loan Status**, **Update Key Dates**, **Adverse Loan**, and document attachment. There is no general borrower/property/loan-details update endpoint in this reference.
- Leads have broader create and update capabilities, including borrower contact and financial fields, owner assignment, lead status, and opt-out fields. A lead can be converted to a loan. Do not assume lead-edit capabilities continue after conversion.
- Eight webhook event types can notify a receiver to fetch the changed loan or lead. The reference does not document a generic `LOAN_UPDATED` event, document-created event, or note/custom-field-specific event.
- Dedicated tracker reads cover 20 tracker types, including title, HOI, payoff, appraisal, CD, rate lock, VOE, funding, and payroll. **No tracker-write endpoint is documented.** Updating a key date is not documented to update its tracker automatically.
- Company credentials are expressly required for documents, fees, branches, and user creation. User-admin UI access and company-scoped API credentials must not be treated as interchangeable.
- Prefer the dedicated tracker endpoint: the `loanTrackers` field embedded in Get Loan Details is marked for future deprecation. Borrower-level `employments` is also marked for deprecation; a separate top-level `employment` array is present.
- Read and write schemas differ. Examples: 37 readable key dates versus 32 writable key dates; lead property types differ between reads and writes; several field types and capitalization differ. Build explicit mappings rather than sending GET responses back into PATCH requests.

## Shared protocol and access

### Authentication

All protected operation pages specify Bearer authentication plus required `X-API-KEY`. Token issuance itself requires `X-API-KEY` and credentials in its JSON body. The authentication narrative says JWT access covers loans in the Company Admin/Owner pipeline; other pages expressly distinguish company/org credentials from user credentials. Verify actual scope before designing company-wide synchronization.

The Overview describes enterprise use and implementation-specific provisioning, typically for organizations over 100 originator seats, with possible implementation fees. It says direct use does not require Zapier. These statements are eligibility/provisioning guidance, not evidence of this account's contract or entitlements.

The Overview generically mentions form-encoded requests, but the individual body-bearing operation pages specify `application/json`. Follow each operation's schema and verify this discrepancy during implementation.

### Limits and errors

- HTTPS is required; the Overview says HTTP requests redirect with 301.
- Rate limits are per API key. The numeric allowance must come from the account executive; none is specified in the reference.
- Response headers: `X-RateLimit-Limit` (per minute), `X-RateLimit-Remaining`, and `X-RateLimit-Reset` (UTC epoch seconds).
- Rate-limit excess can return 429. Overview discusses 503 during traffic spikes and contacting support for persistent 5xx. Neither is shown as an operation-specific response tab.
- Paginated operations use `limit` (default 10, maximum 100) and `offset` (default 0). Loan search, REO, loan notes, and regular/private document lists expose this pair. Lead search also exposes it, but its documented response is an array rather than a `rows/count` envelope.
- Several writes expose query `sync: boolean`, default `true`, described only as “Avoid Polling.” This is **not** a documented two-way synchronization mechanism. Async job handling, `sync=false` behavior, and timeout recovery are not explained.
- Common 401 body: required `message: string`, `status: number`; example/default message `Invalid/Expired Access Token`, status 401. This same template appears even on token issuance.
- Common 400 body: required `message: string`, `code: string`, `status: number`, with Bad Request defaults.
- Common 404 body: required `message: string`, `code: string`, `status: number`, with Resource not found defaults.
- Listed HTTP statuses below reflect visible response tabs, not an exhaustive list of runtime failures. Hook operations document only their success statuses and no response schemas.

### Identifiers and successful write envelopes

Loan reads distinguish numeric `ariveLoanId` (display ID), string `sysGUID`, string `crmReferenceId`, and `deepLinkURL`. Most path IDs are merely typed `string`, without clearly stating which identifier forms are accepted. Preserve all three identifiers and confirm path-ID semantics. Do not infer uniqueness enforcement or idempotency from `crmReferenceId`.

Common loan write response fields: `ariveLoanId: number`, `code: string`, `status: number`, `message: string`, `sysGUID: string`, `deepLinkURL: string`, `createDateTime: string<date-time>`, `originatorEmail: string`, `crmReferenceId: string`.

Common lead write response fields: `ariveLeadId: number`, `code: string`, `status: number`, `message: string`, `sysGUID: string`, `deepLinkURL: string`, `createDateTime: string`, `assigneeEmail: string`, `crmReferenceId: string`. Conversion additionally returns `ariveLoanId`.

## Authentication operation

### 01 Get Auth token

`POST /api/auth/access-token` — responses 200, 401.

Required header: `X-API-KEY`. Required JSON strings: `clientId`, `secret`, `apiKey`. Successful response requires `AccessToken: string`, `ExpiresIn: number` (seconds), `TokenType: string`. No fixed token lifetime, refresh-token flow, or scopes parameter is documented. Use the returned expiry rather than a guessed duration.

## Loan operations

### 02 Search All Loans

`GET /api/loans` — responses 200, 401.

Query: `limit`, `offset`, `orderBy` (`createdAt` or `updatedAt`), `sort` (`ASC` or `DESC`), `searchField`, `searchValue`. `searchValue` is required when `searchField` is supplied. Allowed search fields: `DISPLAY_ID`, `SYSTEM_LOAN_GUID`, `LENDER_LOAN_ID`, `BORROWER_NAME`, `BORROWER_PHONE_NUMBER`, `BORROWER_EMAIL`.

Response requires `rows: array[object]` and `count: number`. Each row documents identifiers, `loanCreatedFrom`, `financedFees`, `loanBorrowers`, `currentLoanStatus`, `modifiedDateTime`, `createDateTime`, `subjectTBDIndicator`, `loanOriginatorEmail`, `creditRepairIndicator`, `archiveIndicator`, loan purpose/refinance/cashout/mortgage types, loan amount, property value, subject property, deep link, and CRM reference.

Nested borrowers: `firstName`, `lastName`, `emailAddressText`, `mobilePhone10digit`, `applicantType`, `borrowerPairLoanAppSequence`, `posAppSubmissionDate`. Status: `status`, `date`, `adverseReason`. Subject property: `addressLineText`, `addressUnitIdentifier`, `city`, `county`, `state`, `postalCode`.

There is no documented updated-since filter, cursor, status filter, or CRM-reference search field. Sorting by update time alone does not establish a reliable incremental export contract.

### 03 Create New Loan

`POST /api/loans` — responses 201, 400, 401. Query `sync` defaults true.

Creates a loan in the Prospect pipeline at Application Intake. Required top-level fields: `originatorEmail: string`, `loanPurpose: string`, and `loanBorrowers: array[object]`.

Optional top-level fields: `externalCreateDate`, `leadSource`, `homebuyingStage`, `refinanceType`, `cashoutPurpose`, `mortgageType`, `baseLoanAmount: number`, `purchasePriceOrEstimatedValue: number`, `estimatedHOIMonthly: string`, `estimatedPropertyTaxesMonthly: string`, `estimatedAssociationDuesMonthly: string`, `estimatedFICO: string`, `propertyType`, `propertyUsageType`, `subjectTBDIndicator: boolean`, `subjectProperty`, `crmReferenceId`.

Conditional rules stated in descriptions: `refinanceType` is required for refinance; `cashoutPurpose` is required for cash-out refinance. Subject property uses `addressLineText`, `addressUnitIdentifier`, `city`, `county`, `state`, `postalCode`.

Each borrower requires `applicantType` (`Borrower` or `CoBorrower`), `borrowerPairLoanAppSequence: number`, `firstName`, `lastName`, and `emailAddressText`. The reference says a single 1003 can have only two borrowers; sequence associates borrowers with a 1003.

Other borrower fields: `middleName`, `suffix`, `nickName`, `birthDate`, `mobilePhone10digit`, `homePhone10digit`, `currentEmployment`, `totalMonthlyIncome: number`, `militaryServiceType`, `maritalStatusType`, `residencyType`, `currentResidence`, `mailingAddressSeparateFromResidence: boolean`, `mailingAddress`, `dependentCount: number`, `dependentsAgesDesc`, `firstTimeHomeBuyer: boolean`, `languagePreference`, `defaultPast7years`.

Current residence: `addressLineText`, `addressUnitIdentifier`, `addressCity`, `addressState`, `addressPostalCode`, `addressCountry`, `durationTermMonths`, `residencyBasisType`. Mailing address uses the address-prefixed fields and `addressCounty`.

Enums: current employment = `Employed`, `Not Employed`, `Self Employed`; marital = `Married`, `Unmarried`, `Separated`; residency = `USCitizen`, `PermanentResidentAlien`, `NonPermanentResidentAlien`, `ForeignNational`; residence basis = `Own`, `Rent`, `LivingRentFree`; language = `chi`, `eng`, `kor`, `spa`, `tgl`, `vie`, `zxx`; prior default = `NO`, `BANKRUPTCY`, `FORECLOSURE`, `BOTH`. Military values are listed in the shared enums section.

Returns the common loan write envelope. No loan-create SSN field is documented, even though lead create/update has SSN fields. The page says only status can be updated after creation; dedicated date and document endpoints elsewhere qualify that broad statement. Do not interpret loan creation as support for general subsequent loan edits.

### 04 Get Real Estate Owned Info

`GET /api/loans/{id}/REO` — responses 200, 401, 404. Required string `id`; paginated.

Response requires `rows` and `count`. Row fields: `propertyStatus`, `maintenanceExpenseAmount`, `ownedUnitCount`, `netRentalIncome`, `homeOwnersInsurance`, `propertyTaxes`, `mortgageInsurance`, `associationOrProjectDues`, `otherAmount`, `streetAddress`, `city`, `state`, `zipCode`, `country`, `propertyType`, `currentMarketValue`, `currentUsage`, `proposedUsage`, `owners: array[string]`. Amounts and unit count are numbers. No REO write operation is listed.

### 05 Get Loan Trackers

`GET /api/loans/{loanId}/trackers` — responses 200, 401, 404. Required string `loanId`; no pagination documented.

Returns `loanTrackers: array[object]` and `count: number`. Each tracker has `name`, `displayName`, `currentTrackerStatus: array[object]`, `trackerStatusesHistory: array[object]`, and, for VOE, `employerName` and `borrowerName`. Each status entry contains `name`, `displayName`, and `date: string<date-time>`.

All 20 documented tracker names:

`TRID`, `RATE_LOCK`, `ITP`, `APPRAISAL`, `HOI`, `TITLE`, `PAYOFFS`, `HOA_FEE`, `FLOOD_CERTIFICATION`, `CD`, `SIGNED_DOCS_WITH_LENDER`, `FUNDING_CONDITIONS`, `FTC`, `FUNDING_WIRE`, `MERS`, `POST_CLOSING_AUDIT`, `PAYROLL`, `CLIENT_REVIEW`, `POST_FUNDING_INVESTOR`, `VOE`.

Labels include Lock Status, ITP Status, HOA Certs, Flood Cert, Final Loan Docs, Funds to Close, MERS Transfer, Commissions / Payroll, and Post Funding (Investor).

Status-name enum across current/history entries:

`INCOMPLETE`, `COMPLETE`, `NOT_SIGNED`, `SIGNED`, `NOT_ORDERED`, `ORDERED`, `PAID`, `ASSIGNED`, `SCHEDULED`, `INSPECTED`, `WAIVED`, `CANCELLED`, `RECEIVED`, `NOT_SENT`, `REQUESTED`, `SENT`, `NOT_REQUESTED`, `SIGNING_SCHEDULED`, `SIGNED_DOCS_RECEIVED`, `NOT_NEEDED`, `CONDITIONS_OUTSTANDING`, `CONDITIONS_SATISFIED`, `NOT_DELIVERED`, `DELIVERED`, `NOT_COMPLETE`, `REGISTERED`, `AWAITING_COLLATERAL_SHIPMENT`, `INVESTOR_PACKAGE_DELIVERED`, `INVESTOR_CONDITIONS_ISSUED`, `INVESTOR_CONDITIONS_CLEARED`, `PURCHASE_ADVICE_RECEIVED`, `CHECK_RECEIVED`, `SERVICING_RELEASED_BOARDED`, `None`, `Requested`, `Locked`, `Expired`, `Rejected`.

Case is significant, especially the lock-related names. The enum is a combined list, not a per-tracker transition matrix. No supported transition rules or tracker-update operation are documented. The dedicated endpoint models current status as an array; the deprecated embedded loan-details tracker models it as an object.

### 06 Get Loan Document Classifications

`GET /api/loans/document-classifications` — responses 200, 401. **Company credentials only.**

Returns `count: number` and `classifications: array[object]`, with `id: number`, `name: string`, `subName: string`. Retrieve organization classifications rather than hardcoding sample labels.

### 07 Get Loan Documents

`GET /api/loans/{id}/documents` — responses 200, 401, 404. **Company credentials only.**

Required string `id`; query `classificationType` matches a classification's name, plus `limit` and `offset`. Returns `rows` and `count`.

Document fields: `id: number`, `documentName`, `groupName`, `type`, `classificationType`, `classificationDescription`, `folderName`, `status`, `isActive: boolean`, `isBorrowerViewable: boolean`, `createdBy`, `modifiedBy`, `createdAt: string<date-time>`, `updatedAt: string<date-time>`, `documentUrl`. No general document metadata edit/delete endpoint is listed.

### 08 Add Loan Document

`POST /api/loans/{id}/documents` — responses 201, 400, 401, 404. **Company credentials only.**

Attaches an already-uploaded file. Required JSON strings: `fileId` from file-access and `documentName`. Document name must include the same extension used for the upload. Optional `classificationType: string|null` must be a returned classification name. Omission/null is described as allowing AI document classification; actual feature availability should be confirmed.

`viewableToBorrowers: array[string]` uses borrower emails. **Empty array means visible to all borrowers; null or omission means not borrower-viewable.** An explicit list grants visibility to those borrowers. The prose permits null although the field label shows array[string]. Do not normalize these cases into one value.

Response: required `id: number`, `documentName: string`, `fileId: string`, plus `classificationType` (schema says object or null although its description calls it a name) and `createdAt: string<date-time>`.

### 09 Get Private Loan Documents

`GET /api/loans/{id}/private-documents` — responses 200, 401, 404. **Company credentials and enabled `PRIVATE_FOLDER` feature required.**

Required string `id`; classification-name filter and pagination match regular document listing. Returns `rows/count` with `id`, `documentName`, `groupName`, `type`, `classificationType`, `classificationDescription`, `isActive`, `createdBy`, `modifiedBy`, `createdAt`, `updatedAt`, `documentUrl`, `folderName`. Its schema does not include regular documents' `status` or `isBorrowerViewable` fields.

### 10 Get Loan Document Signed URL

`GET /api/loans/{id}/documents/{documentId}/signed-url` — responses 200, 401, 404. **Company credentials only.**

Required string path IDs. Returns `documentId: number`, `documentName: string`, `signedUrl: string`, `expiresIn: number` (seconds), and `scanStatus: string`. The example lifetime is 300 seconds, not a guaranteed constant. This is a temporary download URL, not an e-signature operation. Do not persist the URL as permanent document access.

### 11 Get Loan Fees

`GET /api/loans/{id}/fees` — responses 200, 401, 404. **Company credentials only.**

Returns `loanId: number`, `count: number`, `fees`, `prorations`, `dueFromSellers`.

Fee fields: `feeName`, `feeType`, `feeSection: string|null`, `totalAmount: number|null`, numeric `borrowerAmount`, `borrowerPOCAmount`, `sellerAmount`, `sellerPOCAmount`, `lenderAmount`, `lenderPOCAmount`, `otherAmount`, `otherPOCAmount`. Prorations (sections K/L): `amount`, `type`, `feeSection`, `subsectionType`. Seller dues (section N): `amount`, `feePaidToType`. No fee write endpoint is listed.

### 12 Get Borrowers Credit Info

`GET /api/loans/{id}/additionalInfo` — responses 200, 401, 404.

Returns required `creditScores: array[object]`. Each record requires `BorrowerName: string` and `BorrowerRole: string`; `CreditScoreDetails` is an object, default `{}`, with numeric `experian`, `equifax`, `transUnion`. Roles: `Borrower`, `Cosigner`, `NonTitleSpouse`, `TitleHolder`. This reads available scores; it is not an API for ordering a credit report.

### 13 Get Loan Details

`GET /api/loans/{id}` — responses 200, 401, 404. Broad loan read; field inventory is in the appendix below.

Includes current stage/history and adverse reason; borrowers; subject property; lock information; LO/processor/assistant identities; lender/product and loan terms; revenue/compensation; housing expenses and ratios; payments; business contacts; loan team; employment; key dates; branch; and selected non-QM/prepayment fields.

Two deprecations are explicitly noted: borrower `employments` and embedded `loanTrackers`. Use the dedicated tracker endpoint for new work. The embedded tracker list is narrower than the dedicated list.

### 14 Update Loan Status

`PATCH /api/loans/{id}` — responses 200, 401, 404. Query `sync` defaults true.

JSON `loanStages: array[object]`; each stage object requires `stage: string`, `stageDate: string`, and `current: boolean` (default false). Allowed stage names:

`APPLICATION_INTAKE`, `QUALIFICATION`, `PREAPPROVED`, `LOAN_SETUP`, `DISCLOSURE_SENT`, `UNDERWRITING_SUBMITTED`, `APPROVED_WITH_CONDITION`, `RE_SUBMITTAL`, `CLEAR_TO_CLOSE`, `DOCS_OUT`, `DOCS_SIGNED`, `LOAN_FUNDED`, `BROKER_CHECK_RECEIVED`, `COMMISSION_PAID`, `SUSPENDED`.

Additional body fields: `intentToProceedDate`, `lenderLoanNumber`, `lenderNMLS`, `compensationAmt`, `compensationPaidBy`, `crmReferenceId` (all strings). `lenderNMLS` will not be updated if already present on the loan. Compensation payer enum: `Borrower`, `Investor`, `Lender`, `Seller`, `Other`.

Returns the common loan write envelope. The reference does not explain whether `loanStages` appends, merges, or replaces history, what date format is required, how multiple current flags are handled, or which stage transitions are allowed.

### 15 Get Loan Custom Fields

`GET /api/loans/{loanId}/custom-fields` — responses 200, 401, 404.

Org-level credentials return all custom fields; user-level credentials return those viewable under that user's role. Returns required `customFields: array[object]`, each with `description: string`, `defaultValue: object`, and `responses: array[string]`. No stable custom-field ID is described in this schema. No write operation is listed.

### 16 Get Loan Notes

`GET /api/loans/{id}/notes` — responses 200, 401, 404. Paginated.

Required response `count: number`, `loanNotes: array[object]`. Note fields: `id: string`, `text: string`, `edited: boolean`, `createdBy`, `createdByName`, `createdAt`, `updatedAt`, `mentions: object`, `type`, `pinnedBy`, `pinnedByName`, `metadata: object`, `nestedNotes: array[object]`, `reference`, `LoanId: string`, numeric `LoanDocumentId`, `LoanConditionId`, `LoanTrackerId`, `WorkflowTaskId`, `IncomeRecordGroupId`, `LeadDocumentId`. Nested notes expose the same note-style fields. `mentions` and `metadata` have no expanded property definition. No note create/edit/delete operation is listed.

### 17 Get Loan Document Upload Access

`GET /api/loans/{id}/file-access` — responses 200, 400, 401, 404. **Company credentials only.**

Required query `fileName: string` including a supported extension. Response requires `fileId: string` and `fileUploadSignedUrl: string`.

Document upload is three steps: obtain file access; PUT the file bytes to the returned signed URL; call Add Loan Document with its `fileId`. The link is short-lived. The reference does not enumerate supported extensions, maximum file size, PUT content-type requirements, precise upload expiry, or cleanup behavior if attachment fails.

### 18 Adverse Loan

`PATCH /api/loans/{id}/adverse` — responses 200, 401, 404. Query `sync` defaults true.

Required body `adverseDate: string`, `reason: string`. Other fields: `denialReasons: array[string]`, `withdrawnReason: string`, `decisionBasedOnCredit: boolean`, `decisionBasedOnOutsideSource: boolean`, `decisionBasedOnOtherDesc: string`, `deliveryType: string`, `deliveryDate: string`. Delivery values: `Mailed`, `HandDelivered`, `Email`. Returns the common loan write envelope.

Reason values: `APP_DENIED_BY_LENDING_INSTITUTION`, `APP_APPROVED_BUT_NOT_ACCEPTED`, `APP_WITHDRAWN_BY_BORROWER`, `FILE_CLOSED_FOR_INCOMPLETENESS`, `PREAPPROVAL_APPROVED_BUT_NOT_ACCEPTED`, `PREAPPROVAL_DENIED`, `APP_RESCINDED_BY_BORROWER`.

Withdrawn reasons: `COMPETITOR_OFFERED_LOWER_RATE_OR_BETTER_TERMS`, `HOME_FOR_SALE`, `NO_REASON_PROVIDED`, `OTHER`, `PURCHASED_AGREEMENT_CANCELED`, `SERVICE_UNSATISFACTORY`, `UNEXPECTED_LIFE_EVENT`.

Denial reasons: `NO_CREDIT_FILE`, `INSUFFICIENT_NUMBER_OF_CREDIT_REFERENCES_PROVIDED`, `UNACCEPTABLE_TYPE_OF_CREDIT_REFERENCES_PROVIDED`, `LIMITED_CREDIT_EXPERIENCE`, `POOR_CREDIT_PERFORMANCE_WITH_US`, `UNABLE_TO_VERIFY_CREDIT_REFERENCES`, `GARNISHMENT_OR_ATTACHMENT`, `FORECLOSURE_OR_REPOSSESSION`, `EXCESSIVE_OBLIGATIONS`, `EXCESSIVE_OBLIGATIONS_IN_RELATION_TO_INCOME`, `UNACCEPTABLE_PAYMENT_RECORD_ON_PREVIOUS_MORTGAGE`, `LACK_OF_CASH_RESERVES`, `DELINQUENT_PAST_OR_PRESENT_CREDIT_OBLIGATIONS_WITH_OTHERS`, `BANKRUPTCY`, `COLLECTION_ACTION_OR_JUDGMENT`, `NUMBER_OF_RECENT_INQUIRIES_ON_CREDIT_BUREAU_REPORT`, `CREDIT_OTHER`, `UNABLE_TO_VERIFY_EMPLOYMENT`, `LENGTH_OF_EMPLOYMENT`, `TEMPORARY_OR_IRREGULAR_EMPLOYMENT`, `EMPLOYMENT_STATUS_OTHER`, `INCOME_INSUFFICIENT_FOR_AMOUNT_OF_CREDIT_REQUESTED`, `UNABLE_TO_VERIFY_INCOME`, `INCOME_OTHER`, `TEMPORARY_RESIDENCE`, `LENGTH_OF_RESIDENCE`, `UNABLE_TO_VERIFY_RESIDENCE`, `RESIDENCE_OTHER`, `DEPARTMENT_OF_HOUSING_AND_URBAN_DEVELOPMENT`, `DEPARTMENT_OF_VETERANS_AFFAIRS`, `FEDERAL_NATIONAL_MORTGAGE_ASSOCIATION`, `FEDERAL_HOME_LOAN_MORTGAGE_ASSOCIATION`, `INSUFFICIENT_FUNDS_TO_CLOSE_THE_LOAN`, `CREDIT_APPLICATION_INCOMPLETE`, `INADEQUATE_COLLATERAL`, `UNACCEPTABLE_PROPERTY`, `VALUE_OR_TYPE_OF_COLLATERAL_NOT_SUFFICIENT`, `PROPERTY`, `UNACCEPTABLE_APPRAISAL`, `UNACCEPTABLE_LEASEHOLD_ESTATE`, `DO_NOT_GRANT_CREDIT`, `WITHDRAWN_BY_APPLICANT`, `OTHER`, `MORTGAGE_INSURANCE_DENIED`.

Recording delivery fields does not establish that the API generates or sends an adverse-action notice. This operation records an existing human decision; it is not a basis for automated eligibility decisions.

### 19 Update Key Dates

`PATCH /api/loans/{id}/key-dates` — responses 200, 401, 404. Query `sync` defaults true. Returns the common loan write envelope.

All 32 documented body fields are strings:

`appraisalOrderedDate`, `appraisalDeliveryDate`, `taxTranscriptOrderedDate`, `taxTranscriptReceivedDate`, `titleOrderedDate`, `titleReceivedDate`, `hoiOrderedDate`, `hoiReceivedDate`, `preApprovalExpiryDate`, `tridDate`, `initialLESentDate`, `initialLESignedDate`, `mostRecentLESentDate`, `mostRecentLESignedDate`, `intentToProceedDate`, `initialCDSentDate`, `initialCDSignedDate`, `mostRecentCDSentDate`, `mostRecentCDSignedDate`, `appraisalContingency`, `loanContingency`, `closingContingency`, `estFirstPaymentDate`, `firstPaymentDate`, `dateToAvoidEPO`, `earliestClosingDate`, `revisedLESentDate`, `initialLEReceivedDate`, `revisedLEReceivedDate`, `revisedCDSentDate`, `initialCDReceivedDate`, `revisedCDReceivedDate`.

Read-only key dates additionally include `creditOrderDate`, `creditImportDate`, `creditExpirationDate`, `estimatedFundingDate`, `salesContractDate`. No lock-expiration, payoff-expiration, appraisal-scheduled, or title-cleared field is documented in this write operation. Date format, timezone, null/clear semantics, and effects on related trackers are not explained.

## Lead operations

### 20 Get Lead

`GET /api/leads/{id}` — responses 200, 401, 404.

Required response fields: `ariveLeadId: number`, `sysGUID: string`, `assigneeEmail: string`, `loanPurpose: string`, `borrower: object`. Other top-level fields include lead source, refinance/cashout/mortgage type, loan amount, lien, property value/type/use, lead status, TBD flag, subject property, co-borrower, CRM reference/deep link, estimated expenses/FICO, rates/terms, ARM and interest-only settings, homebuying stage, lead provider, current refinance interest rate, unit count, and attachment type. Full field inventory is in the appendix.

No GET SSN field is documented. Read co-borrower uses `CellPhone`; create uses `cellPhone`. GET `noContactRequest` is shown as string, whereas writes use boolean.

### 21 Update Lead

`PATCH /api/leads/{id}` — responses 200, 401, 404. Query `sync` defaults true.

Supports borrower identity/contact/SSN/residence/income/employment fields, contact opt-outs, lead source/provider, owner email, purpose, lead status/lost reason, property/address, requested financing, estimated expenses, rates and terms, plus CRM reference. Exact field groups and enums appear in the appendix. Returns common lead write envelope.

The update schema contains borrower `hasCoBorrower` but **no `coBorrower` object**, unlike lead creation. No merge-versus-replace semantics for nested borrower/address objects or null clearing rules are documented.

### 22 Search all Leads

`GET /api/leads` — responses 200, 401.

Query: `leadSource`, `limit`, `loanPurpose`, `loanType`, `offset`, `orderBy`, `sort`, `status`. `orderBy`: `createdAt`, `updatedAt`, `loanAmount`, `leadStatus`. `status`: `NEW`, `CONTACTED`, `QUALIFIED`, `LOST`. Mortgage types use the shared list excluding REVERSE. No documented borrower-name/email or CRM-reference search.

Success schema is **array of lead objects**, not the loan list's `rows/count`. Fields: `ariveLeadId`, `sysGUID`, `leadSource`, `assigneeEmail`, purpose/refinance/cashout/mortgage type, amount, lien, property value/type/use, status, TBD flag, `subjectProperty`, `borrower`, `coBorrower`, `crmReferenceId`, `deepLinkURL`. Borrower summary has first/last name, email, phone, first-time-homebuyer; co-borrower has first/last name, email, `CellPhone`.

### 23 Create new Lead

`POST /api/leads` — responses 201, 400, 401. Query `sync` defaults true.

Required top level: `assigneeEmail`, `loanPurpose`, `borrower`. Required borrower fields: `firstName`, `lastName`, `emailAddressText`. Optional `coBorrower`, when supplied, marks its first name, last name, and email required. Creates leads with broad financing, property, borrower, contact preferences, source/provider, and CRM fields; see appendix.

Create borrower includes `annualIncome`; update includes both `annualIncome` and `totalMonthlyIncome`. Create includes co-borrower identity, DOB, `cellPhone`, SSN, military service. Returns common lead write envelope. No duplicate detection or idempotency guarantee is documented.

### 24 Convert Lead to Loan

`POST /api/leads/{id}/leadtoloan` — responses 201, 401. Query `sync` defaults true.

Required body: `loanOfficerEmail: string`. Response includes both `ariveLeadId` and `ariveLoanId`, plus common lead write-envelope fields. GUID association and repeated-conversion behavior need confirmation. Preserve the lead-to-loan relationship; loan details includes `originationLeadId`, although its schema incorrectly-looking type is `string<date-time>`.

## User operations

### 25 Get Company Branches

`GET /api/wizeusers/branchList` — responses 200, 401, 404. **Company credentials only.**

Returns `branches: array[object]` with `uuid: string` and `name: string`. UUID is intended for user creation. This is branch lookup, not a user-directory endpoint.

### 26 Create New User

`POST /api/wizeusers` — responses 201, 400, 401. **Company credentials only.**

Required body: `firstName`, `lastName`, `email`, `branches: array[object]`, `WizeRoles: array[object]`. Optional `middleName`, `mobile`, `sendEmail: boolean` (default true), `nmlsId`, `allowAPICredentials: boolean`.

Each branch requires `uuid: string`, `isBillingBranch: boolean`; optional `canEdit: boolean`. Role objects contain `name`; allowed names: `Associate Admin`, `Branch Admin`, `Loan Officer`, `Loan Officer Assistant`, `Processor`, `Disclosure Desk`, `Funder`, `Payroll`, `Lock Desk`, `Closer`.

Response fields: `id: number`, `email`, `firstName`, `middleName`, `lastName`, `fullName`, `nmlsId`, `allowAPICredentials: boolean`, `mobile`, `type`, `status`, `createdAt`, `updatedAt`, `branches`. Returned branches contain `displayName`, `WizeRoles` with role names, `isBillingBranch`, `canEdit`, `LWLicensePayer`, `LWLicenseType`.

This endpoint can send email and grant roles/API access; it has no role in read-only documentation review. No list/update/deactivate-user API is listed.

## Hook operations

### 27 Get Hook Subscriptions

`GET /api/hooks` — response 200.

Optional string query `event`, `status`. Lists authenticated user's subscriptions filtered by credential type. No allowed filter values, response-body schema, pagination, or error tabs are documented.

### 28 Subscribe to ARIVE Events

`POST /api/hooks/subscribe` — response 201.

Required JSON strings: **`WebhookUrl` and `Event`**, with exact capitalization. One event value per request. The eight enum values are:

- `LOAN_CREATED`: new loan file.
- `LOAN_ARCHIVED`: loan archived.
- `LOAN_STAGE_CHANGED`: loan status updated.
- `LOAN_DATE_CHANGED`: dates other than status dates changed on Audit & Dates.
- `LOAN_TRACKERS_UPDATED`: description lists Appraisal, HOI, Title, CD Status, Funding Wire, Final Loan Docs, Commissions/Payroll, Client Review, and VOE trackers.
- `LOAN_APP_SUBMITTED`: POS application submitted.
- `LEAD_CREATED`: new lead.
- `LEAD_UPDATED`: lead updated.

The prose says notifications contain the Loan/Lead ID and event type, after which the receiver calls Get Loan or Get Lead to obtain current data. For tracker events, using the dedicated tracker read is a logical integration choice, not a stated payload guarantee.

No callback JSON schema, exact field names, signature/authentication method, shared-secret configuration, delivery ID, ordering, timestamp, retries/backoff, acknowledgement deadline, replay, retention, or failure-disable behavior is documented. The hook response body is also unspecified. The tracker event description does not enumerate all 20 readable trackers; coverage for RATE_LOCK, PAYOFFS, and others needs verification.

### 29 Unsubscribe from ARIVE Events

`DELETE /api/hooks/unsubscribe/{hookId}` — response 200.

Required string hook ID. No request body or response schema documented. Subscription creation and listing do not document the response property carrying that ID.

## Field appendix

### Shared loan and lead enums

- Purpose: `Purchase`, `Refinance`.
- Refinance: `NoCashOut`, `LimitedCashOut`, `CashOut`.
- Cash-out purpose: `DebtConsolidation`, `Education`, `HomeImprovement`, `InterestRateReduction`, `Other`.
- Mortgage: `Conventional`, `VA`, `FHA`, `USDARuralDevelopment`, `NonQM`, `HELOC`, `HELOAN`; loan operations additionally list `REVERSE`.
- Usage: `PrimaryResidence`, `Investment`, `SecondHome`.
- Homebuying stage: `GETTING_STARTED`, `MAKING_OFFERS`, `FOUND_A_HOUSE_OR_OFFER_PENDING`, `UNDER_CONTRACT`.
- Military: `ActiveDuty`, `Veteran`, `ReserveNationalGuardNeverActivated`.
- Lead statuses: `NEW`, `CONTACTED`, `QUALIFIED`, `LOST`.
- Lead-source read enum: `Advertisement`, `Newspaper`, `Radio`, `RealEstateAgent`, `FinancialAdvisor`, `FriendFamily`, `ReturnClient`, `SearchEngine`, `SocialMedia`, `Television`, `Other`. Write schemas show plain strings; do not infer unrestricted custom-source acceptance without testing.
- Property write enum (new loan / lead create / lead update): `SINGLE_FAMILY_DETACHED`, `SINGLE_FAMILY_ATTACHED`, `TWO_UNIT`, `THREE_UNIT`, `FOUR_UNIT`, `MANUFACTURED_SINGLE_WIDE`, `MANUFACTURED_DOUBLE_WIDE`, `COOP_UNDER_5_STORIES`, `COOP_5_8_STORIES`, `COOP_OVER_8_STORIES`, `TOWNHOUSE`, `MIXED_USE_PROPERTY`, `DETACHED_CONDO`, `SITE_CONDO`, `CONDO_UNDER_5_STORIES`, `CONDO_5_8_STORIES`, `CONDO_OVER_8_STORIES`, `CONDOTEL`, `PUD`, `VACANT_LOT_LAND`, `FIVE_UNIT`, `SIX_UNIT`, `SEVEN_UNIT`, `EIGHT_UNIT`, `NINE_UNIT`, `TEN_UNIT`.
- Property read enum (lead propertyType / loan housingType): `SingleFamily`, `Condominium`, `Cooperative`, `ManufacturedHome`, `PUD`, `TownHouse`, `VACANT_LOT_LAND`, `MultiFamily`.

### Full loan detail field groups

Top-level identifiers and lifecycle: `ariveLoanId`, `sysGUID`, `loanCreatedFrom`, `financedFees`, `currentLoanStatus`, `modifiedDateTime`, `createDateTime`, `subjectTBDIndicator`, `loanOriginatorEmail`, `creditRepairIndicator`, `archiveIndicator`, `loanPurpose`, `refinanceType`, `cashoutPurpose`, `mortgageType`, `baseLoanAmount`, `purchasePriceOrEstimatedValue`, `deepLinkURL`, `crmReferenceId`.

`loanBorrowers[]`: `firstName`, `lastName`, `nickName`, `emailAddressText`, `mobilePhone10digit`, `workPhone`, `homePhone`, `applicantType`, `borrowerPairLoanAppSequence`, `monthOfBirth`, `dayOfBirth`, `maritalStatusType`, `posAppSubmissionDate`, `currentResidence`, `preferedLanguages` (spelling as documented), `firstTimeHomeBuyer`, `birthDate`, `borrowerIncome: object`, `employments[]` (deprecated). Current-residence address fields match loan creation's current residence. Deprecated employments additionally expose `employmentStatusType`, `employmentType`, `YearsOnJobCount`, `MonthsOnJobCount`, and `EmployerAddress` with `LineText`, `AdditionalLineText`, `City`, `County`, `State`, `Country`, `PostalCode`. The separately defined employment record is below.

Referral and purpose context: `leadSource`, `referralContactSourceName`, `referralContactSourceFirstName`, `referralContactSourceLastName`, `referralContactSourceEmail`, `referralContactSourcePhone`, `referralContactSourceCompanyName`, `interestOnlyTermMonthsCount`, `interestOnlyInd`.

`subjectProperty`: `addressLineText`, `addressUnitIdentifier`, `city`, `county`, `state`, `postalCode`, `salesContractAmt`, `housingType`, `financedUnitCount`, `attachmentType` (`Detached` or `Attached`), `propertyUsageType`.

Amounts and economics: `downPayment`, `totalMonthlyHousingExpenseAmt`, `amortizationTerm`, `discountPoints`, `compensation`, `compensationType`, `grossLoanRevenue`, `netLoanRevenue`, `earnestMoneyDeposit`, `sellerCredit`, `homeownersInsuranceMonthlyAmt`, `realEstateTaxMonthlyAmt`, `mIPremiumMonthlyAmt`, `homeownersAssociationDuesAndCondominiumFeesMonthlyAmt`, `purchaseDate`. Compensation, earnest deposit, and seller credit are typed strings; many other amounts are numbers.

Payments: `receivedPayments[]` contains `mi: object|null`, `escrow`, `interest`, `principal`, `paymentDate`, `totalPayment`; aggregates `totalReceivedPaymentAmt`, `receivedPaymentMonthCount`.

Lock/team: `lockStatus: number` (no code-to-label mapping supplied), `lockDate`, `lockExpirationDate`, `loanOriginatorName`, `loanOriginatorPhone`, `loanProcessorName`, `loanProcessorPhone`, `loanProcessorEmail`, `loanOfficerAssistantName`, `loanOfficerAssistantEmail`.

Product/underwriting/fees: `initialFixedPeriodEffectiveMonthsCount`, `normalRateAdjustmentPeriod`, `lenderLoanIdentifier`, `mersNumberforNonDel`, `firstMortgagePrincipalAndInterestMonthlyAmt`, `warehouseBankName`, `floodInsuranceMonthlyAmt`, `amortizationType`, `lienPosition`, `lenderProductName`, `lenderProductCode`, `loanTerm`, `buyDown`, `backEndDTI`, `frontEndDTI`, `impoundWaiver`, `reimbursements`, `toleranceCures`, `brokerFee`, `principalInterestAndPMI`, `CreditReportFee`, `ltv`, `cltv`, `hcltv`.

`loanStatusHistory[]` and `currentLoanStatus`: `status`, `date`, `adverseReason`. Date example is `1990-01-01`; adverse enum is the seven values listed under Adverse Loan. Lender fields: `lenderName`, `lenderNMLS`. `keyDates` includes all writable names listed under Update Key Dates and the five additional read-only names there. `noteRate: number` is top-level.

`loanTeam[]`: `emailAddressText`, `firstName`, `lastName`, `mobilePhone10digit`, `loanRole`, `primary: boolean`. `employment[]`: `employerName`, `positionDesc`, `monthlyIncome`, `employerPhone`, `classificationType`, `startDate`, `endDate`, `selfEmployedInd`, `isPrimaryBorrower`.

`businessContacts[]`: `firstName`, `lastName`, `emailAddressText`, `mobilePhone10digit`, `role`, `subType`, `companyName`, `companyMailingAddress` (`streetAddress`, `unit`, `city`, `county`, `state`, `postalCode`).

Embedded deprecated `loanTrackers[]`: `name`, `displayName`, `currentTrackerStatus: object`, `trackerStatusesHistory[]`, with status `name`, `displayName`, `date`. Its enum lists only APPRAISAL, HOI, TITLE, CD, FUNDING_WIRE, SIGNED_DOCS_WITH_LENDER, PAYROLL, CLIENT_REVIEW. Use operation 05 instead.

Additional top level: `totalLoanAmount`, `industryChannel`, `archiveDate: string<date-time>`, `originationLeadId` (declared `string<date-time>` despite description as lead ID), `estCashToClose`, `orgUnitDisplayName`, `orgUnitId`, `leadProvidedBy`, `fico`, `settlementNumber`, `documentationType`, `prepayPenalty`, `penaltyTerm`, `penaltyAmount`, `lenderMortgageeIdCode`, `sponsorAgentIdCode`.

Documentation-type enum: `FULL_DOC`, `FULL_DOC_24_MO`, `FULL_DOC_12_MO`, `PERS_BANK_STMT_12_MO`, `PERS_BANK_STMT_24_MO`, `BUS_BANK_STMT_12_MO`, `BUS_BANK_STMT_24_MO`, `ASSET_UTILIZATION`, `NO_INCOME`, `REDUCED_DOC`, `CPA_DOC`, `CPA_DOC_24_MO`, `CPA_DOC_12_MO`, `TAX_DOC_24_MO`, `TAX_DOC_12_MO`, `1_YR_TAX_RETURN`, `ALT_DOC_24_MO`, `ALT_DOC_12_MO`, `ASSET_QUALIFIER`, `1099_24_MO`, `1099_12_MO`, `CPA_PNL_12MO_WITHOUT_BKSTMT`, `VOE_ONLY`, `DEBT_SERVICE_COVERAGE_RATIO`. Penalty-term values: `1_YEAR_UNDER` through `5_YEAR_UNDER`.

### Lead write field inventory

Top-level fields shared by create and update: `leadSource`, `otherSourceDesc`, `homebuyingStage`, `assigneeEmail`, `loanPurpose`, `refinanceType`, `cashoutPurpose`, `mortgageType`, `baseLoanAmount`, `purchasePriceOrEstimatedValue`, `estimatedHOIMonthly`, `estimatedPropertyTaxesMonthly`, `estimatedAssociationDuesMonthly`, `estimatedFICO`, `amortizationType`, `noteRate`, `qualifyingRate`, `term`, `interestOnly`, `InterestOnlyTerm`, `lienPosition`, `InitialFixedPeriodEffectiveMonthsCount`, `NormalRateAdjustmentPeriod`, `desiredMonthlyPayment`, `impoundWaiver`, `currentInterestRateRefi`, `propertyType`, `propertyUsageType`, `leadStatus`, `leadLostReason`, `subjectTBDIndicator`, `subjectProperty`, `borrower`, `crmReferenceId`, `leadProvidedBy`. Create additionally includes `coBorrower`.

Numeric fields include amounts, FICO, rates, terms, desired payment, and current refinance rate. Estimated HOI/tax/HOA are strings. `interestOnly` and `subjectTBDIndicator` are booleans. `subjectProperty`: `lineText`, `city`, `county`, `postalCode`, `state`, `unitId` — different names from loan subject-property fields.

Borrower fields shared by create/update: `firstName`, `lastName`, `birthDate`, `emailAddressText`, `mobilePhone10digit`, `ssn`, `militaryServiceType`, `currentResidence`, `employmentType`, `hasRealEstate`, `annualIncome`, `totalLiability`, `firstTimeHomeBuyer`, `yearsSinceForeclosure`, `yearsSinceBankruptcy`, `currentlyOwningAHome`, `planningToSellItBeforeBuying`, `noContactRequest`, `emailOptOut`, `smsOptOut`, `occupancy`, `monthlyRentAmt`, `hasCoBorrower`, `durationMonthsCount`, `durationYearsCount`. Update additionally lists `totalMonthlyIncome`.

Current residence fields: `addressCountry`, `addressCity`, `addressPostalCode`, `addressState`, `addressUnitIdentifier`, `addressLineText`. Create co-borrower: `firstName`, `lastName`, `birthDate`, `emailAddressText`, `cellPhone`, `ssn`, `militaryServiceType`.

Lead-specific write enums: amortization `AdjustableRate`/`Fixed`; lien `FirstLien`/`SecondLien`; impounds `None Waived`, `All Waived`, `Hazard Insurance Waived`, `Property Taxes Waived`; employment `employed`, `active military duty`, `self-employed`, `unemployed`, `retired`, `other`; occupancy `Own`, `Rent`, `LivingRentFree`.

Lost reasons: `Poor_Credit`, `Found_Better_Rate`, `Found_Lower_Fees`, `Foreclosure_Bankruptcy`, `Decided_to_Wait`, `Income_too_Low`, `Self_Employed_1yr`, `Unresponsive`, `Not_Licensed_in_State`, `House_fell_through`, `Other`, `Fake_Email`, `Fake_Number_Email`, `Fake_Phone_Number`, `Not_Interested`.

### Additional lead read fields and differences

Get Lead top level includes the common identity/purpose/property fields, `coBorrower`, `estimatedHOIMonthly`, `estimatedPropertyTaxesMonthly`, `estimatedAssociationDuesMonthly`, `mIPremiumMonthlyAmt`, `floodInsuranceMonthlyAmt`, `estimatedFICO`, `otherSourceDesc`, `amortizationType`, `noteRate`, `qualifyingRate`, `term`, `interestOnly`, `InterestOnlyTerm`, `InitialFixedPeriodEffectiveMonthsCount`, `NormalRateAdjustmentPeriod`, `desiredMonthlyPayment`, `impoundWaiver`, `leadProvidedBy`, `homebuyingStage`, `currentInterestRateRefi`, `financedUnitCount`, `attachmentType`.

Read borrower includes `firstName`, `lastName`, `emailAddressText`, `mobilePhone10digit`, `firstTimeHomeBuyer`, `monthOfBirth`, `dayOfBirth`, `currentResidence`, `employmentType`, `hasCoBorrower`, `hasRealEstate`, `annualIncome`, `totalMonthlyIncome`, `militaryServiceType`, `yearsSinceForeclosure`, `yearsSinceBankruptcy`, `currentlyOwningAHome`, `planningToSellItBeforeBuying`, `totalLiability`, `durationMonthsCount`, `occupancy`, `homePhone10digit`, `emailOptOut`, `smsOptOut`, `noContactRequest`, `birthDate`. Co-borrower read fields: first/last name, email, `CellPhone`, `militaryServiceType`, `monthOfBirth`, `dayOfBirth`, `birthDate`.

Read `estimatedFICO` is string versus number on lead writes; `durationMonthsCount` is string on Get Lead versus number on writes; `noContactRequest` is string on Get Lead versus boolean on writes. Read mortgage/property representations also differ. No documented co-borrower PATCH schema, lead delete/archive endpoint, or lead note/document operation appears in the sidebar.

## Portal context for the later discussion

The existing portal has Arive display-loan-number matching in import workflows and a ProcessingPipelineLoan model. It tracks processor/junior assignments, pipeline stage/sheet, title/payoff/HOI state, appraisal dates, disclosure state, rate lock, notes, lender/type, revenue, and funding/payment dates. Existing webhook-inbox infrastructure is present. This review made no integration changes.

Potential overlap, not an implementation decision:

- Core stage changes have a documented write API and a stage-change event. Portal statuses SUBBED_TO_UW, APPROVED_WITH_CONDITIONS, RE_SUB, CTC, DOCS_OUT, FUNDED, SUSPENDED have plausible Arive counterparts; portal-only states such as ADVERSE_PENDING, PENDING_APPROVAL, and SUSPENDED_RESTRUCTURE need business mapping.
- Title, HOI, appraisal, CD, and payment-date fields overlap with key-date reads/writes. Portal booleans/statuses must not be equated automatically with dates.
- Tracker data can populate richer inbound status/history, but outbound tracker updates are not documented.
- Borrower/property corrections, team assignments, lock expiry, loan notes, and custom fields can be read from Arive; general writes for those loan fields are not documented.
- Lead capture and lead-to-loan conversion can reduce initial re-entry, while document upload/download can reduce file handling.
- Revenue reads and stage compensation writes are not necessarily the same accounting concept. Any mapping needs explicit ownership and reconciliation rules.

## Questions that the reference does not settle

1. Which operations are provisioned for FFL and which credential scope should the portal use?
2. Exact webhook body, authentication/signing, event IDs, ordering, delivery/retry contract, replay, and subscription response shape.
3. Whether tracker events cover all 20 tracker types and whether borrower/property/note/document changes have another event mechanism.
4. Exact path-ID formats, CRM-reference uniqueness, idempotency, and safe reconciliation after ambiguous write timeouts.
5. Stage-array merge semantics, allowed transitions, date formats/timezones, clear/null behavior, and whether date writes affect trackers.
6. Reliable change discovery for data without matching webhook events; pagination stability and any undocumented incremental filters.
7. Sandbox/test-tenant availability, numeric rate limits, request concurrency limits, and supported version/change notification policy.
8. Document size/extensions/PUT headers, scan availability, private-document signed-URL behavior, and AI-classification availability.
9. Meaning of numeric loan `lockStatus`, response typing inconsistencies, and timeline for embedded tracker/employment deprecations.
10. Whether Arive offers provisioned extensions for loan borrower updates, tracker writes, notes/custom-field writes, or processor assignment changes; none is listed here.

This knowledge base is the durable reference for subsequent work. Re-open it before brainstorming or implementation, and re-check the live documentation when resolving a gap or writing an integration.
