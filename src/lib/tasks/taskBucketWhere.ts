import { Prisma, TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import { buildRoleScopedTaskWhere } from '@/lib/tasks/taskScope';
import type { TaskBucketId, TaskDeskKey } from '@/lib/tasks/types';

function disclosureSubmissionWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { kind: TaskKind.SUBMIT_DISCLOSURES },
      {
        AND: [
          { assignedRole: UserRole.DISCLOSURE_SPECIALIST },
          { title: { contains: 'disclosure', mode: 'insensitive' } },
        ],
      },
    ],
  };
}

function qcSubmissionWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { kind: TaskKind.SUBMIT_QC },
      {
        AND: [
          { assignedRole: UserRole.QC },
          { title: { contains: 'qc', mode: 'insensitive' } },
        ],
      },
    ],
  };
}

function disclosureParentWhere(): Prisma.TaskWhereInput {
  return disclosureSubmissionWhere();
}

function qcParentWhere(): Prisma.TaskWhereInput {
  return qcSubmissionWhere();
}

const vaNewUnassignedWhere: Prisma.TaskWhereInput = {
  status: TaskStatus.PENDING,
  workflowState: TaskWorkflowState.NONE,
  assignedUserId: null,
};

function vaTitleNewWhere(): Prisma.TaskWhereInput {
  return {
    AND: [{ kind: TaskKind.VA_TITLE }, vaNewUnassignedWhere],
  };
}

function vaHoiNewWhere(): Prisma.TaskWhereInput {
  return {
    AND: [
      { kind: TaskKind.VA_HOI },
      { status: { not: TaskStatus.COMPLETED } },
      vaNewUnassignedWhere,
    ],
  };
}

export function buildBucketWhere(
  bucketId: TaskBucketId,
  deskKey?: TaskDeskKey
): Prisma.TaskWhereInput | null {
  switch (bucketId) {
    case '__all__':
      return {};

    case 'new-disclosure':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
        ],
      };

    case 'waiting-missing':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.WAITING_ON_LO },
        ],
      };

    case 'lo-responded':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'waiting-approval':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.WAITING_ON_LO_APPROVAL },
        ],
      };

    case 'completed-disclosure':
      return {
        AND: [disclosureSubmissionWhere(), { status: TaskStatus.COMPLETED }],
      };

    case 'submitted-disclosures':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
        ],
      };

    case 'action-required':
      return {
        AND: [
          { kind: TaskKind.LO_NEEDS_INFO },
          { status: { not: TaskStatus.COMPLETED } },
          {
            OR: [{ parentTaskId: null }, { parentTask: disclosureParentWhere() }],
          },
        ],
      };

    case 'returned-to-disclosure':
      return {
        AND: [
          disclosureSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'disclosures-sent-completed':
      return {
        AND: [disclosureSubmissionWhere(), { status: TaskStatus.COMPLETED }],
      };

    case 'qc-new':
      return {
        AND: [
          qcSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
        ],
      };

    case 'qc-waiting-missing':
      return {
        AND: [
          qcSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          {
            workflowState: {
              in: [
                TaskWorkflowState.WAITING_ON_LO,
                TaskWorkflowState.WAITING_ON_LO_APPROVAL,
              ],
            },
          },
        ],
      };

    case 'qc-lo-responded':
      return {
        AND: [
          qcSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'qc-completed-requests':
      return {
        AND: [qcSubmissionWhere(), { status: TaskStatus.COMPLETED }],
      };

    case 'submitted-qc':
      return {
        AND: [
          qcSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
        ],
      };

    case 'action-required-qc':
      return {
        AND: [
          { kind: TaskKind.LO_NEEDS_INFO },
          { status: { not: TaskStatus.COMPLETED } },
          { parentTask: qcParentWhere() },
        ],
      };

    case 'returned-to-qc':
      return {
        AND: [
          qcSubmissionWhere(),
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'qc-completed':
      return {
        AND: [qcSubmissionWhere(), { status: TaskStatus.COMPLETED }],
      };

    case 'va-new-request':
      if (deskKey === 'va_title') return vaTitleNewWhere();
      if (deskKey === 'va_hoi') return vaHoiNewWhere();
      return {
        OR: [vaTitleNewWhere(), vaHoiNewWhere()],
      };

    case 'jr-my-requests':
      return {
        AND: [
          { kind: TaskKind.VA_HOI },
          { status: { not: TaskStatus.COMPLETED } },
          { NOT: { AND: [vaNewUnassignedWhere] } },
        ],
      };

    case 'va-title-started':
      return {
        AND: [
          { kind: TaskKind.VA_TITLE },
          { status: { not: TaskStatus.COMPLETED } },
          { NOT: { AND: [{ kind: TaskKind.VA_TITLE }, vaNewUnassignedWhere] } },
        ],
      };

    case 'va-completed-requests':
      if (deskKey === 'va_title') {
        return { AND: [{ kind: TaskKind.VA_TITLE }, { status: TaskStatus.COMPLETED }] };
      }
      if (deskKey === 'va_hoi') {
        return { AND: [{ kind: TaskKind.VA_HOI }, { status: TaskStatus.COMPLETED }] };
      }
      return {
        OR: [
          { AND: [{ kind: TaskKind.VA_TITLE }, { status: TaskStatus.COMPLETED }] },
          { AND: [{ kind: TaskKind.VA_HOI }, { status: TaskStatus.COMPLETED }] },
        ],
      };

    case 'va-payoff-new':
      return {
        AND: [{ kind: TaskKind.VA_PAYOFF }, vaNewUnassignedWhere],
      };

    case 'va-payoff-started':
      return {
        AND: [
          { kind: TaskKind.VA_PAYOFF },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
          {
            NOT: {
              AND: [{ status: TaskStatus.PENDING }, { assignedUserId: null }],
            },
          },
        ],
      };

    case 'va-payoff-waiting-missing':
      return {
        AND: [
          { kind: TaskKind.VA_PAYOFF },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.WAITING_ON_LO },
        ],
      };

    case 'va-payoff-lo-responded':
      return {
        AND: [
          { kind: TaskKind.VA_PAYOFF },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'va-payoff-completed':
      return {
        AND: [{ kind: TaskKind.VA_PAYOFF }, { status: TaskStatus.COMPLETED }],
      };

    case 'va-appraisal-new':
      return {
        AND: [{ kind: TaskKind.VA_APPRAISAL }, vaNewUnassignedWhere],
      };

    case 'va-appraisal-started':
      return {
        AND: [
          { kind: TaskKind.VA_APPRAISAL },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.NONE },
          {
            NOT: {
              AND: [{ status: TaskStatus.PENDING }, { assignedUserId: null }],
            },
          },
        ],
      };

    case 'va-appraisal-waiting-missing':
      return {
        AND: [
          { kind: TaskKind.VA_APPRAISAL },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.WAITING_ON_LO },
        ],
      };

    case 'va-appraisal-lo-responded':
      return {
        AND: [
          { kind: TaskKind.VA_APPRAISAL },
          { status: { not: TaskStatus.COMPLETED } },
          { workflowState: TaskWorkflowState.READY_TO_COMPLETE },
        ],
      };

    case 'va-appraisal-completed':
      return {
        AND: [{ kind: TaskKind.VA_APPRAISAL }, { status: TaskStatus.COMPLETED }],
      };

    default:
      return null;
  }
}

export function buildScopedBucketWhere(
  bucketId: TaskBucketId,
  role: UserRole,
  userId: string | undefined,
  deskKey?: TaskDeskKey
): Prisma.TaskWhereInput | null {
  const bucketWhere = buildBucketWhere(bucketId, deskKey);
  if (bucketWhere === null) return null;
  const scopeWhere = buildRoleScopedTaskWhere(role, userId);
  if (!scopeWhere || Object.keys(scopeWhere).length === 0) {
    return bucketWhere;
  }
  return { AND: [scopeWhere, bucketWhere] };
}
