'use server';

import { Prisma, TaskStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildRoleScopedTaskWhere } from '@/lib/tasks/taskScope';

type SearchResultItem = {
  id: string;
  kind: 'task';
  title: string;
  borrowerName: string;
  loanNumber: string;
  stage: string;
  status: TaskStatus;
  assignedRole: UserRole | null;
  href: string;
};

export async function searchPortal(query: string): Promise<{
  success: boolean;
  results: SearchResultItem[];
  error?: string;
}> {
  try {
    const q = query.trim();
    if (q.length < 2) {
      return { success: true, results: [] };
    }

    const session = await getServerSession(authOptions);
    const role = (session?.user?.activeRole || session?.user?.role || UserRole.LOAN_OFFICER) as UserRole;
    const userId = session?.user?.id || undefined;

    const scopedWhere = buildRoleScopedTaskWhere(role, userId);
    const searchWhere: Prisma.TaskWhereInput = {
      AND: [
        scopedWhere,
        {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { loan: { borrowerName: { contains: q, mode: 'insensitive' } } },
            { loan: { loanNumber: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ],
    };

    const tasks = await prisma.task.findMany({
      where: searchWhere,
      select: {
        id: true,
        title: true,
        status: true,
        assignedRole: true,
        updatedAt: true,
        loan: {
          select: {
            borrowerName: true,
            loanNumber: true,
            stage: true,
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 12,
    });

    const results: SearchResultItem[] = tasks.map((task) => ({
      id: task.id,
      kind: 'task',
      title: task.title,
      borrowerName: task.loan.borrowerName,
      loanNumber: task.loan.loanNumber,
      stage: task.loan.stage,
      status: task.status,
      assignedRole: task.assignedRole,
      href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
    }));

    return { success: true, results };
  } catch (error) {
    console.error('searchPortal failed', error);
    return { success: false, results: [], error: 'Search failed' };
  }
}
