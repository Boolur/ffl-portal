import { TaskKind, TaskStatus, TaskWorkflowState, type UserRole } from '@prisma/client';

type LoanRef = {
  loanNumber: string;
  borrowerName: string;
};

export type LoVaProgressTaskInput = {
  id: string;
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  submissionData?: unknown;
  loan: LoanRef;
  parentTask?: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
  } | null;
  attachments?: Array<{
    id: string;
    filename: string;
    purpose: string;
  }>;
};

type VaKindKey = 'title' | 'hoi' | 'payoff' | 'appraisal';
export type VaChipState = 'not_started' | 'new' | 'working' | 'waiting' | 'review' | 'completed';

export type LoVaBorrowerProgressItem = {
  loanNumber: string;
  borrowerName: string;
  completedCount: number;
  totalCount: 4;
  chips: Record<VaKindKey, VaChipState>;
  needsLoResponse: boolean;
  actionTaskId: string | null;
  detailTaskId: string | null;
  earliestCreatedAt: Date | null;
  latestUpdatedAt: Date | null;
  stageDetails: Record<
    VaKindKey,
    {
      taskId: string | null;
      completed: boolean;
      proofAttachments: Array<{ id: string; filename: string }>;
    }
  >;
  submissionSnapshot: Array<{ key: string; label: string; value: string }>;
};

const VA_KIND_MAP: Array<{ kind: TaskKind; key: VaKindKey }> = [
  { kind: TaskKind.VA_TITLE, key: 'title' },
  { kind: TaskKind.VA_HOI, key: 'hoi' },
  { kind: TaskKind.VA_PAYOFF, key: 'payoff' },
  { kind: TaskKind.VA_APPRAISAL, key: 'appraisal' },
];

function toDate(value?: Date | string | null) {
  if (!value) return null;
  const dateValue = value instanceof Date ? value : new Date(value);
  return Number.isFinite(dateValue.getTime()) ? dateValue : null;
}

function getChipState(task: LoVaProgressTaskInput): VaChipState {
  if (task.status === TaskStatus.COMPLETED) return 'completed';
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO) return 'waiting';
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) return 'waiting';
  if (task.workflowState === TaskWorkflowState.READY_TO_COMPLETE) return 'review';
  if (task.status === TaskStatus.IN_PROGRESS) return 'working';
  return 'new';
}

function isProofAttachment(purpose?: string) {
  return (purpose || '').toUpperCase() === 'PROOF';
}

const snapshotPreferredOrder = [
  'arriveLoanNumber',
  'borrowerFirstName',
  'borrowerLastName',
  'borrowerPhone',
  'borrowerEmail',
  'loanAmount',
  'homeValue',
  'loanType',
  'loanProgram',
  'loanPurpose',
  'subjectPropertyAddress',
  'yearBuiltProperty',
  'originalCost',
  'yearAquired',
  'mannerInWhichTitleWillBeHeld',
  'employerName',
  'employerAddress',
  'employerDurationLineOfWork',
  'channel',
  'investor',
  'runId',
  'pricingOption',
  'creditReportType',
  'aus',
] as const;

function toReadableLabel(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildSubmissionSnapshot(
  data: unknown
): Array<{ key: string; label: string; value: string }> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const entries = Object.entries(data as Record<string, unknown>).filter(([key, value]) => {
    if (
      key === 'notes' ||
      key === 'notesHistory' ||
      key.toLowerCase().includes('attachment')
    ) {
      return false;
    }
    return (
      value !== null &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    );
  });
  if (entries.length === 0) return [];

  const valueByKey = new Map(entries);
  const ordered: Array<{ key: string; label: string; value: string }> = [];
  for (const key of snapshotPreferredOrder) {
    if (!valueByKey.has(key)) continue;
    ordered.push({
      key,
      label: toReadableLabel(key),
      value: String(valueByKey.get(key)),
    });
    valueByKey.delete(key);
  }

  for (const [key, value] of valueByKey.entries()) {
    ordered.push({
      key,
      label: toReadableLabel(key),
      value: String(value),
    });
  }

  return ordered;
}

function compareByMostRecentUpdate(
  a: Pick<LoVaBorrowerProgressItem, 'latestUpdatedAt'>,
  b: Pick<LoVaBorrowerProgressItem, 'latestUpdatedAt'>
) {
  const left = a.latestUpdatedAt?.getTime() || 0;
  const right = b.latestUpdatedAt?.getTime() || 0;
  return right - left;
}

export function buildLoVaBorrowerProgress(tasks: LoVaProgressTaskInput[]): LoVaBorrowerProgressItem[] {
  const grouped = new Map<
    string,
    {
      loanNumber: string;
      borrowerName: string;
      vaByKind: Partial<Record<VaKindKey, LoVaProgressTaskInput>>;
      appraisalNeedsLoResponse: boolean;
      appraisalActionTaskId: string | null;
      detailTaskId: string | null;
      earliestCreatedAt: Date | null;
      latestUpdatedAt: Date | null;
      submissionData: unknown;
    }
  >();

  for (const task of tasks) {
    const key = `${task.loan.loanNumber}::${task.loan.borrowerName}`.toLowerCase();
    const existing = grouped.get(key) || {
      loanNumber: task.loan.loanNumber,
      borrowerName: task.loan.borrowerName,
      vaByKind: {},
      appraisalNeedsLoResponse: false,
      appraisalActionTaskId: null,
      detailTaskId: null,
      earliestCreatedAt: null,
      latestUpdatedAt: null,
      submissionData: null,
    };

    if (!existing.detailTaskId) {
      existing.detailTaskId = task.id;
    }
    const createdAt = toDate(task.createdAt);
    if (
      createdAt &&
      (!existing.earliestCreatedAt ||
        createdAt.getTime() < existing.earliestCreatedAt.getTime())
    ) {
      existing.earliestCreatedAt = createdAt;
    }

    const updatedAt = toDate(task.updatedAt);
    if (
      updatedAt &&
      (!existing.latestUpdatedAt || updatedAt.getTime() > existing.latestUpdatedAt.getTime())
    ) {
      existing.latestUpdatedAt = updatedAt;
    }

    const mappedVaKind = VA_KIND_MAP.find((entry) => entry.kind === task.kind);
    if (mappedVaKind) {
      existing.vaByKind[mappedVaKind.key] = task;
      if (!existing.submissionData && task.submissionData) {
        existing.submissionData = task.submissionData;
      }
    }

    const isOpenAppraisalParent =
      task.kind === TaskKind.VA_APPRAISAL &&
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.WAITING_ON_LO;
    const isOpenAppraisalChildResponse =
      task.kind === TaskKind.LO_NEEDS_INFO &&
      task.status !== TaskStatus.COMPLETED &&
      task.parentTask?.kind === TaskKind.VA_APPRAISAL;

    if (isOpenAppraisalParent || isOpenAppraisalChildResponse) {
      existing.appraisalNeedsLoResponse = true;
      if (!existing.appraisalActionTaskId || isOpenAppraisalChildResponse) {
        existing.appraisalActionTaskId = task.id;
      }
    }

    grouped.set(key, existing);
  }

  const rows: LoVaBorrowerProgressItem[] = [];
  for (const value of grouped.values()) {
    const hasAnyVaTask = VA_KIND_MAP.some((definition) => Boolean(value.vaByKind[definition.key]));
    if (!hasAnyVaTask) continue;

    const chips: Record<VaKindKey, VaChipState> = {
      title: 'not_started',
      hoi: 'not_started',
      payoff: 'not_started',
      appraisal: 'not_started',
    };

    for (const definition of VA_KIND_MAP) {
      const task = value.vaByKind[definition.key];
      if (!task) continue;
      chips[definition.key] = getChipState(task);
    }

    const completedCount = Object.values(chips).filter((chip) => chip === 'completed').length;
    const stageDetails: LoVaBorrowerProgressItem['stageDetails'] = {
      title: { taskId: null, completed: false, proofAttachments: [] },
      hoi: { taskId: null, completed: false, proofAttachments: [] },
      payoff: { taskId: null, completed: false, proofAttachments: [] },
      appraisal: { taskId: null, completed: false, proofAttachments: [] },
    };
    for (const definition of VA_KIND_MAP) {
      const task = value.vaByKind[definition.key];
      if (!task) continue;
      stageDetails[definition.key] = {
        taskId: task.id,
        completed: task.status === TaskStatus.COMPLETED,
        proofAttachments: (task.attachments || [])
          .filter((att) => isProofAttachment(att.purpose))
          .map((att) => ({ id: att.id, filename: att.filename })),
      };
    }
    rows.push({
      loanNumber: value.loanNumber,
      borrowerName: value.borrowerName,
      completedCount,
      totalCount: 4,
      chips,
      needsLoResponse: value.appraisalNeedsLoResponse,
      actionTaskId: value.appraisalActionTaskId,
      detailTaskId: value.appraisalActionTaskId || value.detailTaskId,
      earliestCreatedAt: value.earliestCreatedAt,
      latestUpdatedAt: value.latestUpdatedAt,
      stageDetails,
      submissionSnapshot: buildSubmissionSnapshot(value.submissionData),
    });
  }

  return rows.sort(compareByMostRecentUpdate);
}

export function isLoVaPilotUser(user: {
  role?: string | null;
  email?: string | null;
  name?: string | null;
}) {
  if ((user.role || '').toUpperCase() !== 'LOAN_OFFICER') return false;
  const email = (user.email || '').trim().toLowerCase();
  const name = (user.name || '').trim().toLowerCase();
  return (
    email === 'mmahjoub@federalfirstlending.com' ||
    (name === 'matt mahjoub' && email.length > 0)
  );
}
