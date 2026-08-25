import { TaskKind, TaskStatus } from '@prisma/client';
import {
  sanitizeProcessingSubmissionData,
  safeSubmissionObject,
  splitBorrowerName,
} from './processingBorrowerDetails';

export type PipelineShortcutMilestone =
  | 'plusOne'
  | 'disclosures'
  | 'pendingStp'
  | 'processing'
  | 'fundings';

export type PipelineSubmissionShortcutEligibility = {
  disclosures: boolean;
  processing: boolean;
};

type SubmissionProgressTask = {
  kind: TaskKind | null;
  status: TaskStatus;
  completedAt: Date | string | null;
};

const PROCESSING_TASK_KINDS = new Set<TaskKind>([
  TaskKind.SUBMIT_PROCESSING,
  TaskKind.SUBMIT_QC,
]);

export function derivePipelineSubmissionShortcuts(
  milestone: PipelineShortcutMilestone,
  tasks: SubmissionProgressTask[],
  canSubmit: boolean,
): PipelineSubmissionShortcutEligibility {
  if (!canSubmit) return { disclosures: false, processing: false };

  const hasDisclosure = tasks.some(
    (task) => task.kind === TaskKind.SUBMIT_DISCLOSURES,
  );
  const hasProcessing = tasks.some(
    (task) => task.kind !== null && PROCESSING_TASK_KINDS.has(task.kind),
  );

  return {
    disclosures:
      (milestone === 'plusOne' || milestone === 'pendingStp') &&
      !hasDisclosure,
    processing:
      !hasProcessing &&
      (milestone === 'plusOne' ||
        milestone === 'disclosures' ||
        milestone === 'pendingStp'),
  };
}

export type SubmissionPrefillLoan = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  borrowerFirstName: string | null;
  borrowerLastName: string | null;
  borrowerPhone: string | null;
  borrowerEmail: string | null;
  amount: { toString(): string } | number | string;
  program: string | null;
  propertyAddress: string | null;
  loanOfficerId: string;
  secondaryLoanOfficerId: string | null;
  loanOfficer: { name: string };
};

const PREFILL_KEYS = [
  'qualificationStatus',
  'preApproved',
  'loanOfficer',
  'loanOfficerId',
  'secondaryLoanOfficerId',
  'borrowerFirstName',
  'borrowerLastName',
  'borrowerPhone',
  'borrowerEmail',
  'coBorrowerFirstName',
  'coBorrowerLastName',
  'coBorrowerPhone',
  'coBorrowerEmail',
  'hasMultipleBorrowers',
  'arriveLoanNumber',
  'channel',
  'investor',
  'lender',
  'leadSource',
  'leadVendor',
  'processingMethod',
  'processingAssignmentGroup',
  'processingAssignmentLabel',
  'loanType',
  'loanProgram',
  'loanAmount',
  'projectedRevenue',
  'propertyStreet',
  'propertyUnit',
  'propertyCity',
  'propertyState',
  'propertyZip',
  'propertyOccupancy',
  'homeValue',
  'employerName',
  'employerAddress',
  'employerDurationLineOfWork',
  'yearBuiltProperty',
  'yearAquired',
  'mannerInWhichTitleWillBeHeld',
  'runId',
  'pricingOption',
  'cashBack',
  'aus',
  'creditReportType',
  'uwmFreeCreditUsed',
  'communityPropertyState',
  'creditReportNotesExp',
  'creditReportNotesEqf',
  'creditReportNotesTui',
  'titleCompany',
  'appraisalWaiver',
  'appraisalNeeded',
  'appraisalNotes',
  'notes',
  'notesGoals',
  'incomeProfile',
] as const;

export function buildPipelineSubmissionPrefill(
  loan: SubmissionPrefillLoan,
  sourceSubmissionData: unknown,
) {
  const source = safeSubmissionObject(
    sanitizeProcessingSubmissionData(sourceSubmissionData),
  );
  const historicalName = splitBorrowerName(loan.borrowerName);
  const canonical: Record<string, unknown> = {
    loanOfficer: loan.loanOfficer.name,
    loanOfficerId: loan.loanOfficerId,
    secondaryLoanOfficerId: loan.secondaryLoanOfficerId || '__NA__',
    arriveLoanNumber: loan.loanNumber,
    loanAmount: String(loan.amount),
    ...(loan.borrowerFirstName || historicalName.firstName
      ? {
          borrowerFirstName:
            loan.borrowerFirstName || historicalName.firstName,
        }
      : {}),
    ...(loan.borrowerLastName || historicalName.lastName
      ? {
          borrowerLastName:
            loan.borrowerLastName || historicalName.lastName,
        }
      : {}),
    ...(loan.borrowerPhone ? { borrowerPhone: loan.borrowerPhone } : {}),
    ...(loan.borrowerEmail ? { borrowerEmail: loan.borrowerEmail } : {}),
    ...(loan.program ? { loanProgram: loan.program } : {}),
    ...(loan.propertyAddress
      ? { propertyStreet: loan.propertyAddress }
      : {}),
  };
  const prefill = Object.fromEntries(
    PREFILL_KEYS.flatMap((key) => {
      const value = source[key];
      return value === undefined || value === null || value === ''
        ? []
        : [[key, value]];
    }),
  ) as Record<string, unknown>;

  if (!prefill.investor && prefill.lender) {
    prefill.investor = prefill.lender;
  }
  if (!prefill.lender && prefill.investor) {
    prefill.lender = prefill.investor;
  }

  return {
    ...prefill,
    ...canonical,
    loanId: loan.id,
  };
}
