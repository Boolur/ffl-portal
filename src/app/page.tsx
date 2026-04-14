import React from 'react';
import { DashboardWrapper } from '@/components/dashboard/DashboardWrapper';
import { getAllTasks } from '@/app/actions/adminActions';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TaskKind, UserRole } from '@prisma/client';
import { startPerfTimer, withPerfMetric } from '@/lib/perf';
import { buildLoanOfficerLoanWhere, buildLoanOfficerTaskWhere } from '@/lib/loanOfficerVisibility';

const LO_DASHBOARD_TASK_KINDS: TaskKind[] = [
  TaskKind.SUBMIT_DISCLOSURES,
  TaskKind.SUBMIT_QC,
  TaskKind.VA_TITLE,
  TaskKind.VA_PAYOFF,
  TaskKind.VA_APPRAISAL,
  TaskKind.VA_HOI,
];

async function getLoans(role?: string | null, userId?: string | null) {
  const endPerf = startPerfTimer('page.dashboard.getLoans.total', {
    role: role || 'UNKNOWN',
  });
  const isAdminOrManager = role === UserRole.ADMIN || role === UserRole.MANAGER;
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isLoanOfficerAssistant = role === UserRole.LOA;
  if (isLoanOfficer || isLoanOfficerAssistant) {
    endPerf({
      count: 0,
      skipped: true,
    });
    return [];
  }
  const where = isAdminOrManager
    ? undefined
    : isLoanOfficer && userId
      ? buildLoanOfficerLoanWhere(userId)
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

async function getDashboardTasks(role: UserRole, userId?: string) {
  const isLoanOfficer = role === UserRole.LOAN_OFFICER;
  const isLoanOfficerAssistant = role === UserRole.LOA;

  if (!isLoanOfficer && !isLoanOfficerAssistant) {
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
          assignedUser: {
            select: {
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
    getDashboardTasks(user.role as UserRole, user.id),
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
    />
  );
  endPerf({
    role: user.role,
    loanCount: loans.length,
    taskCount: adminTasks.length,
  });
  return pageOutput;
}
