import React from 'react';
import { redirect } from 'next/navigation';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getAllTasks } from '@/app/actions/adminActions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TaskKind, UserRole } from '@prisma/client';
import { startPerfTimer, withPerfMetric } from '@/lib/perf';
import { buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';

const LO_DASHBOARD_TASK_KINDS: TaskKind[] = [
  TaskKind.SUBMIT_DISCLOSURES,
  TaskKind.SUBMIT_PROCESSING,
];

async function getLoans(role?: string | null, userId?: string | null) {
  const endPerf = startPerfTimer('page.dashboard.getLoans.total', {
    role: role || 'UNKNOWN',
  });
  endPerf({
    count: 0,
    skipped: true,
    hasUserId: Boolean(userId),
  });
  // Dashboard cards consume task summaries, not loan rows. The previous
  // manager/admin path loaded the entire Loan table and serialized it into a
  // client component even though that role never rendered the loan list.
  return [];
}

async function getDashboardTasks(role: UserRole, userId?: string) {
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;

  if (!isLoanOfficer) {
    return withPerfMetric(
      'query.dashboard.getAllTasks.entry',
      () => getAllTasks({ role, userId }),
      {
        role,
      }
    );
  }

  const where = isLoanOfficer
    ? {
        AND: [
          buildLoanOfficerTaskWhere(userId),
          { kind: { in: LO_DASHBOARD_TASK_KINDS } },
        ],
      }
    : {
        kind: { in: LO_DASHBOARD_TASK_KINDS },
      };

  return withPerfMetric(
    'query.dashboard.getDashboardTasks.loanOfficer',
    () =>
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          kind: true,
          createdAt: true,
          dueDate: true,
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
              stage: true,
              loanOfficer: {
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
      role,
      hasUserId: Boolean(userId),
    }
  );
}

export default async function Home() {
  const endPerf = startPerfTimer('page.dashboard.render.total');
  const session = await getServerSession(authOptions);
  const sessionUserId = session?.user?.id || '';
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
  const [loans, adminTasks, lenderOptions] = await Promise.all([
    getLoans(user.role, user.id),
    getDashboardTasks(user.role as UserRole, user.id),
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
  ]);
  const loanOfficerOptions =
    user.role === UserRole.LOA || user.role === UserRole.LOAN_OFFICER
      ? await prisma.user.findMany({
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
      : [];

  const pageOutput = (
    <DashboardWrapper
      loans={loans}
      adminTasks={adminTasks}
      user={user}
      loanOfficerOptions={loanOfficerOptions}
      lenderOptions={lenderOptions}
    />
  );
  endPerf({
    role: user.role,
    loanCount: loans.length,
    taskCount: adminTasks.length,
  });
  return pageOutput;
}
