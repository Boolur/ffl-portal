import {
  PayrollLoanChannel,
  PayrollProcessingType,
  PayrollUserClassification,
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  assertRetailPayrollApprovalReady,
  getMissingManagerWorksheetFields,
  isSimplifiedRetailPayrollSubmission,
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
