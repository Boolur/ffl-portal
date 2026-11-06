import React from 'react';
import { redirect } from 'next/navigation';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { startPerfTimer } from '@/lib/perf';
import { getDashboardSummary, getRecentDashboardRequests } from '@/lib/dashboardQueries';

export default async function Home() {
  const endPerf = startPerfTimer('page.dashboard.render.total');
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const sessionUserId = session.user.id;
  const sessionRole = (session?.user?.activeRole || session?.user?.role || 'LOAN_OFFICER') as UserRole;
  if (sessionRole === UserRole.ONBOARDING) redirect('/onboarding');
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
  const actor = { id: user.id, role: user.role, name: user.name };
  const [summary, recentRequests, lenderOptions, loanOfficerOptions] = await Promise.all([
    getDashboardSummary(actor),
    getRecentDashboardRequests(actor),
    user.role === UserRole.LOA || user.role === UserRole.LOAN_OFFICER
      ? prisma.lender.findMany({
          where: { active: true },
          select: {
            id: true,
            name: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
      : Promise.resolve([]),
    user.role === UserRole.LOA || user.role === UserRole.LOAN_OFFICER
      ? prisma.user.findMany({
          where: {
            active: true,
            OR: [
              { role: UserRole.LOAN_OFFICER },
              { roles: { has: UserRole.LOAN_OFFICER } },
            ],
          },
          select: {
            id: true,
            name: true,
          },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const pageOutput = (
    <DashboardWrapper
      summary={summary}
      recentRequests={recentRequests}
      user={user}
      loanOfficerOptions={loanOfficerOptions}
      lenderOptions={lenderOptions}
    />
  );
  endPerf({
    role: user.role,
    taskCount: summary.requests.total,
    initialRequestCount: recentRequests.items.length,
  });
  return pageOutput;
}
