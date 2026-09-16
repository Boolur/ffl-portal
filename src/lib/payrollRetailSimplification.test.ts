import {
  PayrollLoanChannel,
  PayrollLeadSource,
  PayrollProcessingType,
  PayrollSplitPayType,
  PayrollUserClassification,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assertRetailPayrollApprovalReady,
  digitalMailerSplitPercent,
  getMissingManagerWorksheetFields,
  isSimplifiedRetailPayrollSubmission,
  rebalanceLoanOfficerSplitPercentages,
  type ManagerWorksheetInput,
} from './payrollRetailSimplification';

function validWorksheet(
  overrides: Partial<ManagerWorksheetInput> = {},
): ManagerWorksheetInput {
  return {
    lender: 'Standard Lender',
    processingType: PayrollProcessingType.IN_HOUSE,
    sectionAComp: '5000',
    yspAmount: '0',
    toleranceCure: '0',
    oneDayInterest: '0',
    wireFee: '0',
    underwritingFee: '0',
    lenderCredit: '0',
    originationFee: '0',
    processingFee: '0',
    appraisalAddBack: '0',
    creditAddBack: '0',
    voeAddBack: '0',
    termiteAddBack: '0',
    appraisalReinspectionAddBack: '0',
    waterTestAddBack: '0',
    loanAmountPriorToFees: '',
    recessionDate: '',
    figureNftyAttachmentName: '',
    ...overrides,
  };
}

describe('Retail payroll simplification eligibility', () => {
  it('only simplifies Retail Non-Delegated submissions', () => {
    expect(isSimplifiedRetailPayrollSubmission(
      PayrollUserClassification.RETAIL,
      PayrollLoanChannel.NON_DELEGATED,
    )).toBe(true);
    expect(isSimplifiedRetailPayrollSubmission(
      PayrollUserClassification.RETAIL,
      PayrollLoanChannel.BROKER,
    )).toBe(false);
    expect(isSimplifiedRetailPayrollSubmission(
      PayrollUserClassification.BROKER,
      PayrollLoanChannel.NON_DELEGATED,
    )).toBe(false);
  });

  it('defaults only simplified Retail Digital Mailer requests to a 50% LO split', () => {
    expect(digitalMailerSplitPercent(true, PayrollLeadSource.DIGITAL_MAILER)).toBe(50);
    expect(digitalMailerSplitPercent(false, PayrollLeadSource.DIGITAL_MAILER)).toBeNull();
    expect(digitalMailerSplitPercent(true, PayrollLeadSource.MAILER)).toBeNull();
  });
});

describe('request-specific payroll split override', () => {
  it('rebalances configured recipients to the percentage remaining after the LO override', () => {
    const result = rebalanceLoanOfficerSplitPercentages([
      { payType: PayrollSplitPayType.PERCENT, splitPercent: 95.5, role: 'Loan Officer' },
      { payType: PayrollSplitPayType.PERCENT, splitPercent: 3, role: 'Manager' },
      { payType: PayrollSplitPayType.PERCENT, splitPercent: 1.5, role: 'Branch' },
    ], 50);

    expect(result.splits.map((split) => split.splitPercent)).toEqual([50, 33.3333, 16.6667]);
    expect(result.needsCompanySplit).toBe(false);
  });

  it('requests a company split when no configured recipient can receive the remainder', () => {
    const result = rebalanceLoanOfficerSplitPercentages([
      { payType: PayrollSplitPayType.PERCENT, splitPercent: 100 },
    ], 50);

    expect(result.splits[0].splitPercent).toBe(50);
    expect(result.needsCompanySplit).toBe(true);
    expect(result.remainingPercent).toBe(50);
  });
});

describe('Retail manager worksheet', () => {
  it('accepts explicit zeroes for every deduction and add-back', () => {
    expect(getMissingManagerWorksheetFields(validWorksheet())).toEqual([]);
  });

  it('requires every detailed amount instead of treating blanks as zero', () => {
    const missing = getMissingManagerWorksheetFields(validWorksheet({
      toleranceCure: '',
      appraisalAddBack: '',
    }));
    expect(missing.map((field) => field.key)).toEqual([
      'toleranceCure',
      'appraisalAddBack',
    ]);
  });

  it('requires Figure/NFTY funded details', () => {
    const missing = getMissingManagerWorksheetFields(validWorksheet({
      lender: 'Figure Lending',
    }));
    expect(missing.map((field) => field.key)).toEqual([
      'loanAmountPriorToFees',
      'recessionDate',
      'figureNftyAttachmentName',
    ]);
  });
});

describe('Retail approval guard', () => {
  it('blocks approval until the manager calculation audit is stamped', () => {
    expect(() => assertRetailPayrollApprovalReady({
      managerCalculationRequired: true,
      managerCalculationCompletedAt: null,
    })).toThrow('Complete and save the compensation worksheet');

    expect(() => assertRetailPayrollApprovalReady({
      managerCalculationRequired: true,
      managerCalculationCompletedAt: new Date(),
    })).not.toThrow();
  });
});
