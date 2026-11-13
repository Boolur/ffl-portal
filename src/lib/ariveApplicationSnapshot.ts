/** Read-only application fields explicitly documented by Arive's loan-details API. */
const loanNumberFields = ['baseLoanAmount', 'totalLoanAmount', 'noteRate', 'amortizationTerm', 'interestOnlyTermMonths', 'initialFixedPeriodMonths', 'rateAdjustmentPeriod'] as const;
const loanTextFields = ['loanTerm', 'amortizationType', 'mortgageType', 'loanPurpose', 'refinanceType', 'cashoutPurpose', 'lienPosition', 'lenderName', 'lenderNMLS', 'lenderLoanIdentifier', 'lenderProductName', 'lenderProductCode', 'documentationType', 'industryChannel'] as const;
const financialFields = ['downPayment', 'earnestMoneyDeposit', 'sellerCredit', 'estimatedCashToClose', 'financedFees', 'discountPoints', 'ltv', 'cltv', 'hcltv', 'frontEndDti', 'backEndDti', 'fico'] as const;
const housingFields = ['principalAndInterest', 'homeownersInsurance', 'propertyTaxes', 'mortgageInsurance', 'associationDues', 'floodInsurance', 'total'] as const;
const residenceFields = ['street', 'unit', 'city', 'state', 'postalCode', 'tenure'] as const;
const propertyTextFields = ['street', 'unit', 'city', 'county', 'state', 'postalCode', 'housingType', 'attachmentType', 'usageType'] as const;
const propertyNumberFields = ['salesContractAmount', 'purchasePriceOrEstimatedValue', 'financedUnitCount'] as const;
type Numbers<K extends string> = Record<K, number | null>;
type Texts<K extends string> = Record<K, string | null>;
export type AriveApplicationApplicant = {
  role: 'Borrower' | 'CoBorrower'; applicationSequence: number | null;
  firstName: string | null; lastName: string | null; maritalStatus: string | null; firstTimeHomeBuyer: boolean | null;
  nickname: string | null; email: string | null; mobilePhone: string | null; workPhone: string | null; homePhone: string | null;
  applicationSubmittedAt: string | null;
  currentResidence: Texts<typeof residenceFields[number]> & { residenceMonths: number | null };
};
export type AriveApplicationEmployment = {
  employerName: string | null; position: string | null; monthlyIncome: number | null;
  employerPhone: string | null; classification: string | null;
  startDate: string | null; endDate: string | null; selfEmployed: boolean | null; isPrimaryBorrower: boolean | null;
};
export type AriveApplicationProperty = Texts<typeof propertyTextFields[number]> & Numbers<typeof propertyNumberFields[number]> & { addressTbd: boolean | null; purchaseDate: string | null };
export type AriveApplicationSnapshot = {
  version: 1;
  loan: Numbers<typeof loanNumberFields[number]> & Texts<typeof loanTextFields[number]> & { interestOnly: boolean | null; impoundWaiver: boolean | null };
  financial: Numbers<typeof financialFields[number]>;
  monthlyHousing: Numbers<typeof housingFields[number]>;
  applicants: AriveApplicationApplicant[];
  employment: AriveApplicationEmployment[];
  property?: AriveApplicationProperty;
};
export type AriveApplicationView = AriveApplicationSnapshot & { syncedAt: string | null };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  return raw && raw.length <= 200 && !/[\u0000-\u001f\u007f]/.test(raw) ? raw : null;
}
function number(value: unknown): number | null {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (typeof raw === 'string' && !/^[+-]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return null;
  const result = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.replace(/[$,]/g, '')) : NaN;
  return Number.isFinite(result) && Math.abs(result) <= 1e15 ? result : null;
}
function bool(value: unknown): boolean | null { return typeof value === 'boolean' ? value : null; }
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === value.slice(0, 10) && Number.isFinite(Date.parse(value)) ? value : null;
}
function numbers<K extends string>(source: Record<string, unknown>, keys: readonly K[]): Numbers<K> {
  return Object.fromEntries(keys.map(key => [key, number(source[key])])) as Numbers<K>;
}
function texts<K extends string>(source: Record<string, unknown>, keys: readonly K[]): Texts<K> {
  return Object.fromEntries(keys.map(key => [key, text(source[key])])) as Texts<K>;
}

function propertySnapshot(value: unknown): AriveApplicationProperty | undefined {
  const source = record(value);
  const property = { ...texts(source, propertyTextFields), ...numbers(source, propertyNumberFields), addressTbd: bool(source.addressTbd), purchaseDate: date(source.purchaseDate) };
  for (const field of propertyNumberFields) {
    if (property[field] !== null && property[field]! < 0) property[field] = null;
  }
  if (property.financedUnitCount !== null && !Number.isInteger(property.financedUnitCount)) property.financedUnitCount = null;
  return Object.values(property).some(value => value !== null) ? property : undefined;
}

/** Re-project stored data too, so a future payload change cannot expose extra fields. */
function sanitizeSnapshot(value: unknown): AriveApplicationSnapshot | null {
  const source = record(value);
  if (source.version !== 1) return null;
  const loan = record(source.loan);
  const property = propertySnapshot(source.property);
  const loanNumbers = numbers(loan, loanNumberFields);
  for (const key of ['interestOnlyTermMonths', 'initialFixedPeriodMonths', 'rateAdjustmentPeriod'] as const) {
    if (loanNumbers[key] !== null && (!Number.isInteger(loanNumbers[key]) || loanNumbers[key]! < 0)) loanNumbers[key] = null;
  }
  return {
    version: 1,
    loan: { ...loanNumbers, ...texts(loan, loanTextFields), interestOnly: bool(loan.interestOnly), impoundWaiver: bool(loan.impoundWaiver) },
    financial: numbers(record(source.financial), financialFields),
    monthlyHousing: numbers(record(source.monthlyHousing), housingFields),
    applicants: (Array.isArray(source.applicants) ? source.applicants : []).slice(0, 20).flatMap(raw => {
      const applicant = record(raw); const residence = record(applicant.currentResidence);
      if (applicant.role !== 'Borrower' && applicant.role !== 'CoBorrower') return [];
      const sequence = number(applicant.applicationSequence);
      const months = number(residence.residenceMonths);
      return [{ role: applicant.role, applicationSequence: sequence !== null && Number.isInteger(sequence) && sequence >= 0 ? sequence : null,
        firstName: text(applicant.firstName), lastName: text(applicant.lastName), maritalStatus: text(applicant.maritalStatus), firstTimeHomeBuyer: bool(applicant.firstTimeHomeBuyer),
        nickname: text(applicant.nickname), email: text(applicant.email), mobilePhone: text(applicant.mobilePhone), workPhone: text(applicant.workPhone), homePhone: text(applicant.homePhone),
        applicationSubmittedAt: date(applicant.applicationSubmittedAt),
        currentResidence: { ...texts(residence, residenceFields), residenceMonths: months !== null && Number.isInteger(months) && months >= 0 ? months : null },
      }];
    }),
    employment: (Array.isArray(source.employment) ? source.employment : []).slice(0, 100).map(raw => {
      const employment = record(raw);
      return { employerName: text(employment.employerName), position: text(employment.position), monthlyIncome: number(employment.monthlyIncome),
        employerPhone: text(employment.employerPhone), classification: text(employment.classification),
        startDate: date(employment.startDate), endDate: date(employment.endDate), selfEmployed: bool(employment.selfEmployed), isPrimaryBorrower: bool(employment.isPrimaryBorrower) };
    }).filter(job => Object.values(job).some(value => value !== null)),
    ...(property ? { property } : {}),
  };
}

/** Call only after the existing worker has verified the loan identity and complete read. */
export function projectAriveApplicationSnapshot(value: unknown): AriveApplicationSnapshot {
  const source = record(value);
  const property = record(source.subjectProperty);
  return sanitizeSnapshot({
    version: 1,
    loan: { ...Object.fromEntries([...loanNumberFields, ...loanTextFields].map(key => [key, source[key]])),
      interestOnly: source.interestOnlyInd, interestOnlyTermMonths: source.interestOnlyTermMonthsCount,
      initialFixedPeriodMonths: source.initialFixedPeriodEffectiveMonthsCount, rateAdjustmentPeriod: source.normalRateAdjustmentPeriod,
      impoundWaiver: source.impoundWaiver },
    financial: { ...Object.fromEntries(financialFields.map(key => [key, source[key]])), estimatedCashToClose: source.estCashToClose, frontEndDti: source.frontEndDTI, backEndDti: source.backEndDTI },
    monthlyHousing: {
      principalAndInterest: source.firstMortgagePrincipalAndInterestMonthlyAmt, homeownersInsurance: source.homeownersInsuranceMonthlyAmt,
      propertyTaxes: source.realEstateTaxMonthlyAmt, mortgageInsurance: source.mIPremiumMonthlyAmt,
      associationDues: source.homeownersAssociationDuesAndCondominiumFeesMonthlyAmt, floodInsurance: source.floodInsuranceMonthlyAmt, total: source.totalMonthlyHousingExpenseAmt,
    },
    property: {
      street: property.addressLineText, unit: property.addressUnitIdentifier, city: property.city, county: property.county,
      state: property.state, postalCode: property.postalCode, housingType: property.housingType,
      attachmentType: property.attachmentType, usageType: property.propertyUsageType,
      salesContractAmount: property.salesContractAmt, financedUnitCount: property.financedUnitCount,
      purchasePriceOrEstimatedValue: source.purchasePriceOrEstimatedValue, addressTbd: source.subjectTBDIndicator,
      purchaseDate: source.purchaseDate,
    },
    applicants: (Array.isArray(source.loanBorrowers) ? source.loanBorrowers : []).map(raw => {
      const borrower = record(raw); const residence = record(borrower.currentResidence);
      return { role: borrower.applicantType, applicationSequence: borrower.borrowerPairLoanAppSequence,
        firstName: borrower.firstName, lastName: borrower.lastName, maritalStatus: borrower.maritalStatusType, firstTimeHomeBuyer: borrower.firstTimeHomeBuyer,
        nickname: borrower.nickName, email: borrower.emailAddressText, mobilePhone: borrower.mobilePhone10digit, workPhone: borrower.workPhone, homePhone: borrower.homePhone,
        applicationSubmittedAt: borrower.posAppSubmissionDate,
        currentResidence: { street: residence.addressLineText, unit: residence.addressUnitIdentifier, city: residence.addressCity,
          state: residence.addressState, postalCode: residence.addressPostalCode, tenure: residence.residencyBasisType, residenceMonths: residence.durationTermMonths } };
    }),
    // The current, top-level employment collection is documented. Do not infer
    // borrowerIncome keys or fall back to deprecated borrower employments.
    employment: (Array.isArray(source.employment) ? source.employment : []).map(raw => {
      const job = record(raw); return { employerName: job.employerName, position: job.positionDesc, monthlyIncome: job.monthlyIncome,
        employerPhone: job.employerPhone, classification: job.classificationType,
        startDate: job.startDate, endDate: job.endDate, selfEmployed: job.selfEmployedInd, isPrimaryBorrower: job.isPrimaryBorrower };
    }),
  })!;
}

/** Caller must enforce existing loan access and verified integration enrollment. */
export function readAriveApplicationView(snapshot: unknown, syncedAt: Date | null | undefined): AriveApplicationView | null {
  const application = sanitizeSnapshot(record(snapshot).application);
  return application ? { ...application, syncedAt: syncedAt && Number.isFinite(syncedAt.getTime()) ? syncedAt.toISOString() : null } : null;
}
