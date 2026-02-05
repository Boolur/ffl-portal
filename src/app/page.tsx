import React from 'react';
import { prisma } from '@/lib/prisma';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getAllTasks } from '@/app/actions/adminActions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

async function getLoans() {
  const loans = await prisma.loan.findMany({
    orderBy: { updatedAt: 'desc' },
  });
  
  return loans.map(l => ({
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
  };
  const [loans, adminTasks] = await Promise.all([
    getLoans(),
    getAllTasks()
  ]);

  return <DashboardWrapper loans={loans} adminTasks={adminTasks} user={user} />;
}
