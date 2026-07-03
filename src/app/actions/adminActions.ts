'use server';

import { prisma } from '@/lib/prisma';
import { TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import { withPerfMetric } from '@/lib/perf';
import { buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';
import { isAdmin } from '@/lib/adminTiers';

type TaskFilter = {
  role?: UserRole | null;
  userId?: string | null;
};

export async function getAllTasks(filter?: TaskFilter) {
  const role = filter?.role ?? null;
  const userId = filter?.userId || null;
  const isAdminOrManager =
    isAdmin(role) || role === UserRole.MANAGER || role === UserRole.LOA;
  const isGenericVa = role === UserRole.VA;
  const isJrProcessor = role === UserRole.PROCESSOR_JR;
  const needsRichTaskPayload = role === UserRole.LOAN_OFFICER || role === UserRole.LOA;
  const activeTaskWhere = {
    OR: [
      { kind: { in: [TaskKind.SUBMIT_DISCLOSURES, TaskKind.SUBMIT_PROCESSING] } },
      {
        kind: TaskKind.LO_NEEDS_INFO,
        parentTask: {
          is: {
            kind: { in: [TaskKind.SUBMIT_DISCLOSURES, TaskKind.SUBMIT_PROCESSING] },
          },
        },
      },
    ],
  };

  const where = isAdminOrManager
    ? activeTaskWhere
    : role === UserRole.LOAN_OFFICER
      ? {
          AND: [buildLoanOfficerTaskWhere(userId), activeTaskWhere],
        }
      : isGenericVa
        ? { id: '__none__' }
      : isJrProcessor
        ? {
            AND: [
              activeTaskWhere,
              {
                OR: [
                  {
                    kind: TaskKind.SUBMIT_PROCESSING,
                    status: TaskStatus.PENDING,
                    workflowState: TaskWorkflowState.NONE,
                    assignedUserId: null,
                  },
                  {
                    kind: TaskKind.SUBMIT_PROCESSING,
                    status: { not: TaskStatus.COMPLETED },
                    assignedUserId: userId,
                  },
                  {
                    kind: TaskKind.SUBMIT_PROCESSING,
                    status: TaskStatus.COMPLETED,
                  },
                ],
              },
            ],
          }
      : {
          AND: [
            activeTaskWhere,
            {
              OR: [
                { assignedRole: role ?? undefined },
                { assignedUserId: userId ?? undefined },
              ],
            },
          ],
        };

  const tasks = needsRichTaskPayload
    ? await withPerfMetric(
        'query.dashboard.getAllTasks.rich',
        () =>
          prisma.task.findMany({
        where,
        include: {
          loan: {
            select: {
              loanNumber: true,
              borrowerName: true,
              loanOfficer: {
                select: {
                  name: true,
                },
              },
              secondaryLoanOfficer: {
                select: {
                  name: true,
                },
              },
            },
          },
          attachments: {
            select: {
              id: true,
              filename: true,
              purpose: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
          assignedUser: {
            select: {
              id: true,
              name: true,
            },
          },
          parentTask: {
            select: {
              kind: true,
              assignedRole: true,
              title: true,
              submissionData: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
          }),
        {
          role: role || 'UNKNOWN',
        }
      )
    : await withPerfMetric(
        'query.dashboard.getAllTasks.lean',
        () =>
          prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          createdAt: true,
          dueDate: true,
          kind: true,
          workflowState: true,
          disclosureReason: true,
          parentTaskId: true,
          loanOfficerApprovedAt: true,
          assignedRole: true,
          assignedUserId: true,
          assignedUser: {
            select: {
              id: true,
              name: true,
            },
          },
          loan: {
            select: {
              loanNumber: true,
              borrowerName: true,
              loanOfficer: {
                select: {
                  name: true,
                },
              },
              secondaryLoanOfficer: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
          }),
        {
          role: role || 'UNKNOWN',
        }
      );

  return tasks;
}
