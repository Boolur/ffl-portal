'use server';

import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';

export type TeamMemberSummary = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  loanCount: number;
  taskCount: number;
};

export type MemberDetails = {
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    createdAt: Date;
  };
  loans: Array<{
    id: string;
    loanNumber: string;
    borrowerName: string;
    amount: number;
    stage: string;
    updatedAt: Date;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    kind?: string | null;
    status: string;
    priority: string;
    createdAt: Date;
    attachments?: Array<{
      id: string;
      filename: string;
      purpose: string;
      createdAt: Date;
    }>;
    loan: {
      loanNumber: string;
      borrowerName: string;
    };
  }>;
};

export async function getTeamMembers(): Promise<TeamMemberSummary[]> {
  const users = await prisma.user.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      _count: {
        select: {
          loansAsLO: true,
          assignedTasks: true,
        },
      },
    },
  });

  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    loanCount: u._count.loansAsLO,
    taskCount: u._count.assignedTasks,
  }));
}

export async function getMemberDetails(userId: string): Promise<MemberDetails | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) return null;

  const loans = await prisma.loan.findMany({
    where: { loanOfficerId: userId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      loanNumber: true,
      borrowerName: true,
      amount: true,
      pipelineStage: {
        select: { name: true },
      },
      updatedAt: true,
    },
  });

  const tasks = await prisma.task.findMany({
    where: { assignedUserId: userId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      priority: true,
      createdAt: true,
      attachments: {
        select: { id: true, filename: true, purpose: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
        },
      },
    },
  });

  return {
    user,
    loans: loans.map((l) => ({
      ...l,
      amount: Number(l.amount),
      stage: l.pipelineStage?.name || 'Unassigned',
    })),
    tasks,
  };
}

export async function reassignLoans(oldUserId: string, newUserId: string) {
  if (!oldUserId || !newUserId) {
    return { success: false, error: 'Both users are required.' };
  }

  try {
    await prisma.loan.updateMany({
      where: { loanOfficerId: oldUserId },
      data: { loanOfficerId: newUserId },
    });
    revalidatePath('/team');
    return { success: true };
  } catch (error) {
    console.error('Failed to reassign loans', error);
    return { success: false, error: 'Failed to reassign loans.' };
  }
}
