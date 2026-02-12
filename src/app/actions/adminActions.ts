'use server';

import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';

type TaskFilter = {
  role?: UserRole | null;
  userId?: string | null;
};

export async function getAllTasks(filter?: TaskFilter) {
  const role = filter?.role ?? null;
  const userId = filter?.userId || null;
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;

  const where = isAdminOrManager
    ? undefined
    : role === UserRole.LOAN_OFFICER
      ? {
          loan: {
            loanOfficerId: userId || undefined,
          },
        }
      : {
          OR: [
            { assignedRole: role ?? undefined },
            { assignedUserId: userId ?? undefined },
          ],
        };

  const tasks = await prisma.task.findMany({
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
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return tasks;
}
