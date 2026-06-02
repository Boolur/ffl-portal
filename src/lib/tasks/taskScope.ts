import { Prisma, TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import { buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';
import { isAdmin } from '@/lib/adminTiers';

const VA_TASK_KINDS: TaskKind[] = [
  TaskKind.VA_TITLE,
  TaskKind.VA_PAYOFF,
  TaskKind.VA_APPRAISAL,
];

export function buildRoleScopedTaskWhere(
  role: UserRole,
  userId?: string
): Prisma.TaskWhereInput {
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isLoanOfficerAssistant = role === UserRole.LOA;
  const isAdminOrManager = isAdmin(role) || role === UserRole.MANAGER;
  const isGenericVa = role === UserRole.VA;

  if (isAdminOrManager || isLoanOfficerAssistant) {
    return {};
  }

  if (isLoanOfficer && userId) {
    return buildLoanOfficerTaskWhere(userId);
  }

  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return {
      OR: [{ assignedRole: role }, { kind: TaskKind.SUBMIT_DISCLOSURES }],
    };
  }

  if (role === UserRole.QC) {
    return {
      OR: [{ assignedRole: role }, { kind: TaskKind.SUBMIT_QC }],
    };
  }

  if (isGenericVa) {
    return {
      OR: [
        { kind: { in: VA_TASK_KINDS } },
        ...(userId ? [{ assignedUserId: userId }] : []),
        { assignedRole: UserRole.VA },
      ],
    };
  }

  if (role === UserRole.PROCESSOR_JR) {
    if (userId) {
      return {
        OR: [
          {
            kind: TaskKind.VA_HOI,
            status: TaskStatus.PENDING,
            workflowState: TaskWorkflowState.NONE,
            assignedUserId: null,
          },
          {
            kind: TaskKind.VA_HOI,
            status: { not: TaskStatus.COMPLETED },
            assignedUserId: userId,
          },
          {
            kind: TaskKind.VA_HOI,
            status: TaskStatus.COMPLETED,
          },
        ],
      };
    }
    return { OR: [{ kind: TaskKind.VA_HOI }] };
  }

  if (
    (role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL) &&
    userId
  ) {
    const specialistKind =
      role === UserRole.VA_TITLE
        ? TaskKind.VA_TITLE
        : role === UserRole.VA_PAYOFF
          ? TaskKind.VA_PAYOFF
          : TaskKind.VA_APPRAISAL;
    return {
      OR: [
        {
          kind: specialistKind,
          status: TaskStatus.PENDING,
          workflowState: TaskWorkflowState.NONE,
          assignedUserId: null,
        },
        {
          kind: specialistKind,
          status: { not: TaskStatus.COMPLETED },
          assignedUserId: userId,
        },
        {
          kind: specialistKind,
          status: TaskStatus.COMPLETED,
        },
      ],
    };
  }

  return {
    OR: [{ assignedRole: role }],
  };
}

export function shouldIncludeTimelineAttachments(
  role: UserRole,
  tasks: Array<{ kind: TaskKind | null; parentTaskId: string | null }>
): boolean {
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isAdminOrManager = isAdmin(role) || role === UserRole.MANAGER || role === UserRole.LOA;
  const hasTimelineRelevantTasks = tasks.some(
    (task) =>
      task.kind === TaskKind.VA_TITLE ||
      task.kind === TaskKind.VA_PAYOFF ||
      task.kind === TaskKind.VA_APPRAISAL ||
      task.kind === TaskKind.VA_HOI ||
      task.parentTaskId
  );
  return (
    (isLoanOfficer || isAdminOrManager) &&
    hasTimelineRelevantTasks &&
    process.env.TASK_TIMELINE_EAGER !== 'false'
  );
}
