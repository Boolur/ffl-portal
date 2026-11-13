import { describe, expect, it } from 'vitest';
import { projectAriveApplicationSnapshot, readAriveApplicationView } from './ariveApplicationSnapshot';

describe('allowlisted Arive application snapshot', () => {
  it('maps documented loan economics and monthly housing without inventing totals or changing ratios', () => {
    const snapshot = projectAriveApplicationSnapshot({ baseLoanAmount: 240000, totalLoanAmount: 245000, noteRate: 6.125, amortizationTerm: 360, loanTerm: '360',
      downPayment: 0, earnestMoneyDeposit: '$1,250.00', sellerCredit: '2500', estCashToClose: 9120.50, ltv: 80, backEndDTI: 36.5, frontEndDTI: 22,
      firstMortgagePrincipalAndInterestMonthlyAmt: 1500, homeownersInsuranceMonthlyAmt: 125, realEstateTaxMonthlyAmt: 350, mIPremiumMonthlyAmt: 0,
      homeownersAssociationDuesAndCondominiumFeesMonthlyAmt: 50, floodInsuranceMonthlyAmt: null, totalMonthlyHousingExpenseAmt: 2025,
    });
    expect(snapshot.loan).toMatchObject({ baseLoanAmount: 240000, totalLoanAmount: 245000, noteRate: 6.125, amortizationTerm: 360, loanTerm: '360' });
    expect(snapshot.financial).toMatchObject({ downPayment: 0, earnestMoneyDeposit: 1250, sellerCredit: 2500, estimatedCashToClose: 9120.5, ltv: 80, backEndDti: 36.5, frontEndDti: 22 });
    expect(snapshot.monthlyHousing).toEqual({ principalAndInterest: 1500, homeownersInsurance: 125, propertyTaxes: 350, mortgageInsurance: 0, associationDues: 50, floodInsurance: null, total: 2025 });
    expect(projectAriveApplicationSnapshot({ firstMortgagePrincipalAndInterestMonthlyAmt: 1500 }).monthlyHousing.total).toBeNull();
  });
  it('keeps borrower pairs and current employment explicit while omitting birth dates, SSNs, accounts and opaque income', () => {
    const snapshot = projectAriveApplicationSnapshot({ ssn: 'DO_NOT_EXPOSE', accountNumber: 'DO_NOT_EXPOSE', borrowerIncome: { total: 'DO_NOT_EXPOSE' },
      loanBorrowers: [
        { applicantType: 'Borrower', borrowerPairLoanAppSequence: 1, firstName: 'Synthetic', lastName: 'Applicant', birthDate: 'DO_NOT_EXPOSE', ssn: 'DO_NOT_EXPOSE', borrowerIncome: { account: 'DO_NOT_EXPOSE' }, employments: [{ employerName: 'DO_NOT_EXPOSE_DEPRECATED' }], firstTimeHomeBuyer: false, maritalStatusType: 'Married', currentResidence: { addressLineText: 'Synthetic street', addressCity: 'Synthetic city', residencyBasisType: 'Rent', durationTermMonths: 24, privateAccount: 'DO_NOT_EXPOSE' } },
        { applicantType: 'CoBorrower', borrowerPairLoanAppSequence: 1, firstName: 'Second', lastName: 'Applicant' },
        { applicantType: 'Borrower', borrowerPairLoanAppSequence: 2, firstName: 'Other', lastName: 'Pair' },
        { applicantType: 'Unknown', firstName: 'DO_NOT_EXPOSE_UNKNOWN_ROLE' },
      ],
      employment: [{ employerName: 'Synthetic employer', positionDesc: 'Analyst', monthlyIncome: 7000, startDate: '2024-02-29', endDate: null, selfEmployedInd: false, isPrimaryBorrower: true, accountNumber: 'DO_NOT_EXPOSE' }],
    });
    expect(snapshot.applicants.map(a => [a.role, a.applicationSequence])).toEqual([['Borrower', 1], ['CoBorrower', 1], ['Borrower', 2]]);
    expect(snapshot.applicants[0]).toMatchObject({ firstTimeHomeBuyer: false, currentResidence: { street: 'Synthetic street', city: 'Synthetic city', tenure: 'Rent', residenceMonths: 24 } });
    expect(snapshot.employment).toEqual([{ employerName: 'Synthetic employer', position: 'Analyst', monthlyIncome: 7000, employerPhone: null, classification: null, startDate: '2024-02-29', endDate: null, selfEmployed: false, isPrimaryBorrower: true }]);
    expect(JSON.stringify(snapshot)).not.toContain('DO_NOT_EXPOSE');
  });
  it('treats absent, malformed and unsupported values as missing rather than zero or guessed dates', () => {
    const snapshot = projectAriveApplicationSnapshot({ baseLoanAmount: '', totalLoanAmount: Infinity, noteRate: { value: 7 }, downPayment: true,
      sellerCredit: '10,00', estCashToClose: 'unavailable', employment: [{ employerName: 'Synthetic employer', startDate: '2026-02-30', monthlyIncome: null, selfEmployedInd: 'false' }] });
    expect(snapshot.loan).toMatchObject({ baseLoanAmount: null, totalLoanAmount: null, noteRate: null });
    expect(snapshot.financial).toMatchObject({ downPayment: null, sellerCredit: null, estimatedCashToClose: null });
    expect(snapshot.employment[0]).toMatchObject({ startDate: null, monthlyIncome: null, selfEmployed: null });
    expect(projectAriveApplicationSnapshot(null).employment).toEqual([]);
  });
  it('maps only documented subject-property fields and keeps purchase price/value distinct from contract amount', () => {
    const snapshot = projectAriveApplicationSnapshot({ purchasePriceOrEstimatedValue: 800000, subjectTBDIndicator: false,
      subjectProperty: { addressLineText: '123 Synthetic Lane', addressUnitIdentifier: '2', city: 'Sample', county: 'Example', state: 'CA', postalCode: '90000',
        salesContractAmt: '750000', housingType: 'SingleFamily', financedUnitCount: 1, attachmentType: 'Detached', propertyUsageType: 'PrimaryResidence',
        yearBuilt: 'DO_NOT_EXPOSE', yearAcquired: 'DO_NOT_EXPOSE', vesting: 'DO_NOT_EXPOSE', accountNumber: 'DO_NOT_EXPOSE' },
    });
    expect(snapshot.property).toEqual({ street: '123 Synthetic Lane', unit: '2', city: 'Sample', county: 'Example', state: 'CA', postalCode: '90000',
      salesContractAmount: 750000, purchasePriceOrEstimatedValue: 800000, housingType: 'SingleFamily', financedUnitCount: 1,
      attachmentType: 'Detached', usageType: 'PrimaryResidence', addressTbd: false, purchaseDate: null });
    expect(JSON.stringify(snapshot)).not.toContain('DO_NOT_EXPOSE');
  });
  it('does not invent property details from lead aliases or unsupported fields and preserves older snapshot compatibility', () => {
    expect(projectAriveApplicationSnapshot({ subjectProperty: { lineText: 'Lead address', unitId: '2', yearBuilt: 1990, estimatedValue: 800000 }, propertyUsageType: 'Investment' }).property).toBeUndefined();
    expect(projectAriveApplicationSnapshot({ purchasePriceOrEstimatedValue: -1, subjectProperty: { financedUnitCount: 1.5, salesContractAmt: false, city: { privateData: 'DO_NOT_EXPOSE' } } }).property).toBeUndefined();
    expect(projectAriveApplicationSnapshot({ purchasePriceOrEstimatedValue: 0, subjectTBDIndicator: true }).property).toMatchObject({ purchasePriceOrEstimatedValue: 0, addressTbd: true, street: null });
    const oldSnapshot = projectAriveApplicationSnapshot({ baseLoanAmount: 100000 });
    expect(readAriveApplicationView({ application: oldSnapshot }, null)?.property).toBeUndefined();
  });
  it('re-applies the property allowlist to stored snapshots without exposing added private fields', () => {
    const application = projectAriveApplicationSnapshot({ subjectProperty: { city: 'Sample' } });
    Object.assign(application.property!, { accountNumber: 'DO_NOT_EXPOSE', rawResponse: { privateData: 'DO_NOT_EXPOSE' } });
    const view = readAriveApplicationView({ application }, null);
    expect(view?.property).toMatchObject({ city: 'Sample', street: null, purchasePriceOrEstimatedValue: null });
    expect(JSON.stringify(view)).not.toContain('DO_NOT_EXPOSE');
  });
  it('re-applies the allowlist when reading stored snapshots, excludes metadata, and preserves provenance time', () => {
    const application = projectAriveApplicationSnapshot({ baseLoanAmount: 100000 });
    Object.assign(application, { ssn: 'DO_NOT_EXPOSE', rawResponse: 'DO_NOT_EXPOSE' });
    Object.assign(application.financial, { bankAccountNumber: 'DO_NOT_EXPOSE' });
    const view = readAriveApplicationView({ application, privatePayload: 'DO_NOT_EXPOSE' }, new Date('2026-11-10T12:00:00Z'));
    expect(view).toMatchObject({ version: 1, syncedAt: '2026-11-10T12:00:00.000Z', loan: { baseLoanAmount: 100000 } });
    expect(JSON.stringify(view)).not.toContain('DO_NOT_EXPOSE');
    expect(readAriveApplicationView({}, null)).toBeNull();
    expect(readAriveApplicationView({ application: { version: 99 } }, null)).toBeNull();
  });
  it('keeps documented contact fields attached to each applicant instead of borrowing contacts from another pair', () => {
    const snapshot = projectAriveApplicationSnapshot({ loanBorrowers: [
      { applicantType: 'Borrower', borrowerPairLoanAppSequence: 1, firstName: 'Primary', nickName: 'Preferred', emailAddressText: 'primary@example.test', mobilePhone10digit: '2025550100', homePhone: '2025550101', workPhone: '2025550102', posAppSubmissionDate: '2026-11-10T18:30:00Z', birthDate: 'DO_NOT_EXPOSE', monthOfBirth: 'DO_NOT_EXPOSE' },
      { applicantType: 'CoBorrower', borrowerPairLoanAppSequence: 1, emailAddressText: 'secondary@example.test', mobilePhone10digit: '2025550110' },
      { applicantType: 'Borrower', borrowerPairLoanAppSequence: 2, emailAddressText: 'pair-two@example.test' },
    ] });
    expect(snapshot.applicants.map(person => [person.applicationSequence, person.role, person.email, person.mobilePhone])).toEqual([
      [1, 'Borrower', 'primary@example.test', '2025550100'], [1, 'CoBorrower', 'secondary@example.test', '2025550110'], [2, 'Borrower', 'pair-two@example.test', null],
    ]);
    expect(snapshot.applicants[0]).toMatchObject({ nickname: 'Preferred', homePhone: '2025550101', workPhone: '2025550102', applicationSubmittedAt: '2026-11-10T18:30:00Z' });
    Object.assign(snapshot.applicants[0], { ssn: 'DO_NOT_EXPOSE', birthDate: 'DO_NOT_EXPOSE', borrowerIncome: { total: 'DO_NOT_EXPOSE' } });
    expect(JSON.stringify(readAriveApplicationView({ application: snapshot }, null))).not.toContain('DO_NOT_EXPOSE');
  });
  it('maps documented payment terms, lender references, financing and employer information without interpreting ambiguous units', () => {
    const snapshot = projectAriveApplicationSnapshot({ interestOnlyInd: false, interestOnlyTermMonthsCount: 0, initialFixedPeriodEffectiveMonthsCount: 60, normalRateAdjustmentPeriod: 12,
      impoundWaiver: true, cashoutPurpose: 'DebtConsolidation', industryChannel: 'Brokered', lenderLoanIdentifier: 'SYNTHETIC-42', lenderNMLS: '12345', lenderProductCode: 'ARM-5',
      financedFees: '1250.00', discountPoints: 0.5, purchaseDate: '2026-11-12',
      employment: [{ employerName: 'Synthetic employer', employerPhone: '2025550199', classificationType: 'Primary', monthlyIncome: 5000 }],
    });
    expect(snapshot.loan).toMatchObject({ interestOnly: false, interestOnlyTermMonths: 0, initialFixedPeriodMonths: 60, rateAdjustmentPeriod: 12, impoundWaiver: true,
      cashoutPurpose: 'DebtConsolidation', industryChannel: 'Brokered', lenderLoanIdentifier: 'SYNTHETIC-42', lenderNMLS: '12345', lenderProductCode: 'ARM-5' });
    expect(snapshot.financial).toMatchObject({ financedFees: 1250, discountPoints: 0.5 });
    expect(snapshot.property).toMatchObject({ purchaseDate: '2026-11-12', salesContractAmount: null });
    expect(snapshot.employment[0]).toMatchObject({ employerPhone: '2025550199', classification: 'Primary' });
  });
  it('safely normalizes older v1 snapshots without the added application fields', () => {
    const view = readAriveApplicationView({ application: { version: 1, loan: { baseLoanAmount: 250000 }, financial: { downPayment: 0 },
      applicants: [{ role: 'Borrower', firstName: 'Original', currentResidence: { street: 'Original residence' } }],
      employment: [{ employerName: 'Original employer', monthlyIncome: 5000 }], property: { city: 'Original city' },
    } }, null);
    expect(view?.loan).toMatchObject({ baseLoanAmount: 250000, interestOnly: null, interestOnlyTermMonths: null, initialFixedPeriodMonths: null, rateAdjustmentPeriod: null, impoundWaiver: null, lenderLoanIdentifier: null });
    expect(view?.financial).toMatchObject({ downPayment: 0, financedFees: null, discountPoints: null });
    expect(view?.applicants[0]).toMatchObject({ firstName: 'Original', nickname: null, email: null, mobilePhone: null, workPhone: null, homePhone: null, applicationSubmittedAt: null });
    expect(view?.employment[0]).toMatchObject({ employerName: 'Original employer', monthlyIncome: 5000, employerPhone: null, classification: null });
    expect(view?.property).toMatchObject({ city: 'Original city', purchaseDate: null });
  });
  it('rejects malformed extended values and never guesses lead-only aliases or unstructured income', () => {
    const snapshot = projectAriveApplicationSnapshot({ interestOnlyInd: 'false', interestOnlyTermMonthsCount: -1, initialFixedPeriodEffectiveMonthsCount: 1.5, normalRateAdjustmentPeriod: false,
      impoundWaiver: 'true', purchaseDate: '2026-02-30', financedFees: true, discountPoints: Infinity, assets: [{ amount: 'DO_NOT_EXPOSE' }], liabilities: [{ amount: 'DO_NOT_EXPOSE' }],
      loanBorrowers: [{ applicantType: 'Borrower', emailAddressText: { secret: 'DO_NOT_EXPOSE' }, mobilePhone10digit: ['DO_NOT_EXPOSE'], workPhone: 'bad\ncontact', posAppSubmissionDate: 'yesterday', borrowerIncome: { total: 'DO_NOT_EXPOSE' } }],
      employment: [{ employerName: 'Synthetic employer', employerPhone: { secret: 'DO_NOT_EXPOSE' }, classificationType: ['DO_NOT_EXPOSE'] }],
    });
    expect(snapshot.loan).toMatchObject({ interestOnly: null, interestOnlyTermMonths: null, initialFixedPeriodMonths: null, rateAdjustmentPeriod: null, impoundWaiver: null });
    expect(snapshot.financial).toMatchObject({ financedFees: null, discountPoints: null });
    expect(snapshot.applicants[0]).toMatchObject({ email: null, mobilePhone: null, workPhone: null, applicationSubmittedAt: null });
    expect(snapshot.employment[0]).toMatchObject({ employerPhone: null, classification: null });
    expect(snapshot.property).toBeUndefined();
    expect(JSON.stringify(snapshot)).not.toContain('DO_NOT_EXPOSE');
    expect(projectAriveApplicationSnapshot({ interestOnly: true, InterestOnlyTerm: 60, InitialFixedPeriodEffectiveMonthsCount: 60 }).loan).toMatchObject({ interestOnly: null, interestOnlyTermMonths: null, initialFixedPeriodMonths: null });
  });
});
