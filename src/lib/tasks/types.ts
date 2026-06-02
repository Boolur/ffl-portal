import {
  DisclosureDecisionReason,
  TaskAttachmentPurpose,
  Prisma,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';

export const BUCKET_TASK_PAGE_SIZE = 7;

export type TaskDeskKey =
  | 'disclosure'
  | 'qc'
  | 'va_title'
  | 'va_payoff'
  | 'va_appraisal'
  | 'va_hoi'
  | 'loan_officer'
  | 'flat';

export type TaskBucketId =
  | 'all'
  | 'new'
  | 'pending-lo'
  | 'completed'
  | 'new-disclosure'
  | 'waiting-missing'
  | 'waiting-approval'
  | 'lo-responded'
  | 'completed-disclosure'
  | 'submitted-disclosures'
  | 'action-required'
  | 'returned-to-disclosure'
  | 'disclosures-sent-completed'
  | 'submitted-qc'
  | 'action-required-qc'
  | 'returned-to-qc'
  | 'qc-completed'
  | 'qc-new'
  | 'qc-waiting-missing'
  | 'qc-lo-responded'
  | 'qc-completed-requests'
  | 'va-new-request'
  | 'jr-my-requests'
  | 'va-title-started'
  | 'va-completed-requests'
  | 'va-payoff-new'
  | 'va-payoff-started'
  | 'va-payoff-waiting-missing'
  | 'va-payoff-lo-responded'
  | 'va-payoff-completed'
  | 'va-appraisal-new'
  | 'va-appraisal-started'
  | 'va-appraisal-waiting-missing'
  | 'va-appraisal-lo-responded'
  | 'va-appraisal-completed'
  | '__all__';

export type TaskBucketSort =
  | 'updated_desc'
  | 'updated_asc'
  | 'created_asc'
  | 'created_desc'
  | 'borrower_asc'
  | 'borrower_desc';

export type TaskBucketCursor = {
  offset: number;
};

export type TaskRow = {
  id: string;
  loanId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  parentTask: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
    title: string;
    submissionData: Prisma.JsonValue | null;
  } | null;
  loanOfficerApprovedAt: Date | null;
  submissionData: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage: string;
    loanOfficer: {
      name: string;
    } | null;
    secondaryLoanOfficer: {
      name: string;
    } | null;
  };
  assignedRole: UserRole | null;
  assignedUser: {
    id: string;
    name: string;
  } | null;
  attachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
    sourceTaskKind: TaskKind | null;
    sourceTaskAssignedRole: UserRole | null;
    sourceTaskCreatedAt: Date | null;
  }[];
  timelineAttachments: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
    uploadedByName: string | null;
    uploadedByRole: UserRole | null;
    sourceTaskKind: TaskKind | null;
    sourceTaskAssignedRole: UserRole | null;
    sourceTaskCreatedAt: Date | null;
  }[];
  vaCompletionSummary?: {
    titleDone: boolean;
    payoffDone: boolean;
    appraisalDone: boolean;
  };
};

export type BucketDefinition = {
  id: TaskBucketId;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
};

export function isTaskBucketId(value: string): value is TaskBucketId {
  const ids: TaskBucketId[] = [
    'all',
    'new',
    'pending-lo',
    'completed',
    'new-disclosure',
    'waiting-missing',
    'waiting-approval',
    'lo-responded',
    'completed-disclosure',
    'submitted-disclosures',
    'action-required',
    'returned-to-disclosure',
    'disclosures-sent-completed',
    'submitted-qc',
    'action-required-qc',
    'returned-to-qc',
    'qc-completed',
    'qc-new',
    'qc-waiting-missing',
    'qc-lo-responded',
    'qc-completed-requests',
    'va-new-request',
    'jr-my-requests',
    'va-title-started',
    'va-completed-requests',
    'va-payoff-new',
    'va-payoff-started',
    'va-payoff-waiting-missing',
    'va-payoff-lo-responded',
    'va-payoff-completed',
    'va-appraisal-new',
    'va-appraisal-started',
    'va-appraisal-waiting-missing',
    'va-appraisal-lo-responded',
    'va-appraisal-completed',
    '__all__',
  ];
  return ids.includes(value as TaskBucketId);
}
