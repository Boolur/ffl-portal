import { TaskKind, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { LoVaProgressTaskInput } from '@/lib/loVaProgress';
import { buildRoleScopedTaskWhere } from '@/lib/tasks/taskScope';

const LO_VA_PROGRESS_KINDS: TaskKind[] = [
  TaskKind.VA_TITLE,
  TaskKind.VA_PAYOFF,
  TaskKind.VA_APPRAISAL,
  TaskKind.VA_HOI,
  TaskKind.SUBMIT_DISCLOSURES,
  TaskKind.SUBMIT_QC,
  TaskKind.LO_NEEDS_INFO,
];

export async function getLoVaProgressTasks(
  role: UserRole,
  userId?: string
): Promise<LoVaProgressTaskInput[]> {
  const scope = buildRoleScopedTaskWhere(role, userId);
  const where = {
    AND: [
      scope,
      {
        kind: { in: LO_VA_PROGRESS_KINDS },
      },
    ],
  };

  const tasks = await prisma.task.findMany({
    where: Object.keys(scope).length === 0 ? { kind: { in: LO_VA_PROGRESS_KINDS } } : where,
    select: {
      id: true,
      kind: true,
      status: true,
      workflowState: true,
      disclosureReason: true,
      assignedRole: true,
      assignedUser: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
      createdAt: true,
      updatedAt: true,
      completedAt: true,
      submissionData: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          loanOfficer: { select: { name: true } },
          secondaryLoanOfficer: { select: { name: true } },
        },
      },
      parentTask: {
        select: {
          kind: true,
          assignedRole: true,
        },
      },
      attachments: {
        select: {
          id: true,
          filename: true,
          purpose: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 2000,
  });

  return tasks;
}
