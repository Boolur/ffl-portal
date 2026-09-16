import {
  PayrollLoanChannel,
  PayrollProcessingType,
  PayrollUserClassification,
} from '@prisma/client';

export function isSimplifiedRetailPayrollSubmission(
  classification: PayrollUserClassification | null | undefined,
  loanChannel: PayrollLoanChannel,
) {
  return classification === PayrollUserClassification.RETAIL &&
    loanChannel === PayrollLoanChannel.NON_DELEGATED;
}

export type ManagerWorksheetField =
  | 'sectionAComp'
  | 'yspAmount'
  | 'toleranceCure'
  | 'oneDayInterest'
  | 'wireFee'
  | 'underwritingFee'
  | 'lenderCredit'
  | 'originationFee'
  | 'processingFee'
  | 'appraisalAddBack'
  | 'creditAddBack'
  | 'voeAddBack'
  | 'termiteAddBack'
  | 'appraisalReinspectionAddBack'
  | 'waterTestAddBack'
  | 'loanAmountPriorToFees'
  | 'recessionDate'
  | 'figureNftyAttachmentName';

export type ManagerWorksheetInput = Record<ManagerWorksheetField, string> & {
  lender: string;
  processingType: PayrollProcessingType;
};

export type MissingManagerWorksheetField = {
  key: ManagerWorksheetField;
  label: string;
};

function parseMoney(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function getMissingManagerWorksheetFields(
  input: ManagerWorksheetInput,
): MissingManagerWorksheetField[] {
  const missing: MissingManagerWorksheetField[] = [];
  const requireAmount = (
    key: ManagerWorksheetField,
    label: string,
    options?: { positive?: boolean; signed?: boolean },
  ) => {
    const value = parseMoney(input[key]);
    if (
      value === null ||
      (options?.positive ? value <= 0 : !options?.signed && value < 0)
    ) {
      missing.push({ key, label });
    }
  };

  requireAmount('sectionAComp', 'Section A', { positive: true });
  requireAmount('yspAmount', 'YSP', { signed: true });
  requireAmount('toleranceCure', 'Tolerance Cure');
  requireAmount('oneDayInterest', '1 Day Interest');
  requireAmount('wireFee', 'Wire Fee');
  requireAmount('underwritingFee', 'Underwriting Fee');
  requireAmount('lenderCredit', 'Lender Credit');
  requireAmount('originationFee', 'Origination Fee');
  if (input.processingType === PayrollProcessingType.IN_HOUSE) {
    requireAmount('processingFee', 'Processing Fee');
  }
  requireAmount('appraisalAddBack', 'Appraisal');
  requireAmount('creditAddBack', 'Credit Report');
  requireAmount('voeAddBack', 'VOE');
  requireAmount('termiteAddBack', 'Termite');
  requireAmount('appraisalReinspectionAddBack', 'Appraisal Reinspection');
  requireAmount('waterTestAddBack', 'Water Test');

  const lender = input.lender.trim().toUpperCase();
  if (lender.includes('FIGURE') || lender.includes('NFTY')) {
    requireAmount('loanAmountPriorToFees', 'Loan Amount Prior to Fees', { positive: true });
    if (!input.recessionDate) missing.push({ key: 'recessionDate', label: 'Recession Date' });
    if (!input.figureNftyAttachmentName.trim()) {
      missing.push({ key: 'figureNftyAttachmentName', label: 'Funded/Details Screenshot' });
    }
  }

  return missing;
}

export function assertRetailPayrollApprovalReady(request: {
  managerCalculationRequired: boolean;
  managerCalculationCompletedAt: Date | null;
}) {
  if (request.managerCalculationRequired && !request.managerCalculationCompletedAt) {
    throw new Error('Complete and save the compensation worksheet before approving this Retail estimate.');
  }
}
