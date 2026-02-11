import React from 'react';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getAllTasks } from '@/app/actions/adminActions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';

async function getLoans(role?: string | null, userId?: string | null) {
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const where = isAdminOrManager
    ? undefined
    : isLoanOfficer && userId
      ? { loanOfficerId: userId }
      : { id: '__none__' };

  const loans = await prisma.loan.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
  });

  return loans.map((l) => ({
    ...l,
    amount: Number(l.amount),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));
}

export default async function Home() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'User',
    role: session?.user?.role || 'LOAN_OFFICER',
    id: session?.user?.id || '',
  };
  const [loans, adminTasks] = await Promise.all([
    getLoans(user.role, user.id),
    getAllTasks({ role: user.role as UserRole, userId: user.id }),
  ]);

  return <DashboardWrapper loans={loans} adminTasks={adminTasks} user={user} />;
}
