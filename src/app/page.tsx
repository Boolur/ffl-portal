import React from 'react';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getAllTasks } from '@/app/actions/adminActions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { startPerfTimer, withPerfMetric } from '@/lib/perf';

async function getLoans(role?: string | null, userId?: string | null) {
  const endPerf = startPerfTimer('page.dashboard.getLoans.total', {
    role: role || 'UNKNOWN',
  });
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const where = isAdminOrManager
    ? undefined
    : isLoanOfficer && userId
      ? { loanOfficerId: userId }
      : { id: '__none__' };

  const loans = await withPerfMetric(
    'query.dashboard.getLoans',
    () =>
      prisma.loan.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      }),
    {
      role: role || 'UNKNOWN',
      hasUserId: Boolean(userId),
    }
  );

  const mapped = loans.map((l) => ({
    ...l,
    amount: Number(l.amount),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));
  endPerf({
    count: mapped.length,
  });
  return mapped;
}

export default async function Home() {
  const endPerf = startPerfTimer('page.dashboard.render.total');
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id || '';
  const sessionRole = (session?.user?.activeRole || session?.user?.role || 'LOAN_OFFICER') as UserRole;
  const sessionRoles = ((session?.user?.roles as UserRole[] | undefined) || [sessionRole]);
  const userFlags = sessionUserId
    ? await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: {
          loQcTwoRowPilot: true,
          loDisclosureSubmissionEnabled: true,
          loQcSubmissionEnabled: true,
        },
      })
    : null;
  const user = {
    name: session?.user?.name || 'User',
    email: session?.user?.email || '',
    role: sessionRole,
    activeRole: sessionRole,
    roles: sessionRoles,
    id: sessionUserId,
    loQcTwoRowPilot: Boolean(userFlags?.loQcTwoRowPilot),
    loDisclosureSubmissionEnabled:
      userFlags?.loDisclosureSubmissionEnabled ?? true,
    loQcSubmissionEnabled: userFlags?.loQcSubmissionEnabled ?? true,
  };
  const [loans, adminTasks] = await Promise.all([
    getLoans(user.role, user.id),
    withPerfMetric(
      'query.dashboard.getAllTasks.entry',
      () => getAllTasks({ role: user.role as UserRole, userId: user.id }),
      {
        role: user.role,
      }
    ),
  ]);

  const pageOutput = <DashboardWrapper loans={loans} adminTasks={adminTasks} user={user} />;
  endPerf({
    role: user.role,
    loanCount: loans.length,
    taskCount: adminTasks.length,
  });
  return pageOutput;
}
