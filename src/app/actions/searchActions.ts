'use server';

import { Prisma, TaskKind, TaskStatus, UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';
import { isAdmin } from '@/lib/adminTiers';

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

function getRoleScopedTaskWhere(role: UserRole, userId?: string): Prisma.TaskWhereInput {
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isAdminOrManager =
    isAdmin(role) || role === UserRole.MANAGER || role === UserRole.LOA;
  const isGenericVa = role === UserRole.VA;

  if (isAdminOrManager) return {};

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
        { kind: { in: [TaskKind.VA_TITLE, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL] } },
        ...(userId ? [{ assignedUserId: userId }] : []),
        { assignedRole: UserRole.VA },
      ],
    };
  }

  if (role === UserRole.PROCESSOR_JR) {
    return {
      OR: [{ assignedRole: UserRole.PROCESSOR_JR }, { kind: TaskKind.VA_HOI }],
    };
  }

  return { OR: [{ assignedRole: role }] };
}

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

    const scopedWhere = getRoleScopedTaskWhere(role, userId);
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
