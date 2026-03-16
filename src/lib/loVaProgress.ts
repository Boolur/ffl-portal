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
  updatedAt?: Date | string | null;
  loan: LoanRef;
  parentTask?: {
    kind: TaskKind | null;
    assignedRole: UserRole | null;
  } | null;
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
  latestUpdatedAt: Date | null;
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
      latestUpdatedAt: Date | null;
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
      latestUpdatedAt: null,
    };

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
    rows.push({
      loanNumber: value.loanNumber,
      borrowerName: value.borrowerName,
      completedCount,
      totalCount: 4,
      chips,
      needsLoResponse: value.appraisalNeedsLoResponse,
      actionTaskId: value.appraisalActionTaskId,
      latestUpdatedAt: value.latestUpdatedAt,
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
