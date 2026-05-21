'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import {
  PayrollCompRequestStatus,
  PayrollLoanChannel,
  PayrollProcessingType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { canAccessPayroll } from '@/lib/adminTiers';
import { canAccessPayrollPortal } from '@/lib/payrollPilot';
import { prisma } from '@/lib/prisma';

const PAYROLL_ADMIN_PATHS = [
  '/admin/payroll',
  '/admin/payroll/users',
  '/admin/payroll/requests',
  '/admin/payroll/reporting',
];
const PAYROLL_PORTAL_PATH = '/payroll';

export type PayrollCompSplitInput = {
  recipientUserId: string;
  roleLabel: string;
  splitPercent: number;
};

export type PayrollCompPlanInput = {
  loanOfficerId: string;
  baseSplitPercent: number;
  active?: boolean;
  notes?: string;
  splits: PayrollCompSplitInput[];
};

export type PayrollCompRequestInput = {
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  expectedRevenue: number;
  submitterNotes?: string;
};

export type PayrollRequestFilters = {
  status?: PayrollCompRequestStatus | 'ALL';
  loanOfficerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
};

export type PayrollReportFilters = {
  startDate?: string;
  endDate?: string;
  loanOfficerId?: string;
  status?: PayrollCompRequestStatus | 'ALL';
};

export type PayrollSplitSnapshot = {
  id: string;
  recipientUserId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  roleLabel: string;
  splitPercent: number;
  amount: number;
  sortOrder: number;
};

export type PayrollRequestRow = {
  id: string;
  loanOfficerId: string;
  loanOfficerName: string;
  loanOfficerEmail: string;
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  expectedRevenue: number;
  status: PayrollCompRequestStatus;
  submittedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  submitterNotes: string | null;
  adminNotes: string | null;
  rejectionReason: string | null;
  splits: PayrollSplitSnapshot[];
};

export type PayrollUserPlanRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  plan: {
    id: string;
    baseSplitPercent: number;
    active: boolean;
    notes: string | null;
    updatedAt: string;
    splits: Array<{
      id: string;
      recipientUserId: string;
      recipientName: string;
      recipientEmail: string;
      roleLabel: string;
      splitPercent: number;
      sortOrder: number;
    }>;
  } | null;
};

type SessionActor = {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
};

const requestInclude = {
  loanOfficer: { select: { id: true, name: true, email: true } },
  splits: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      recipientUserId: true,
      recipientName: true,
      recipientEmail: true,
      roleLabel: true,
      splitPercent: true,
      amount: true,
      sortOrder: true,
    },
  },
};

function normalizeRoleList(role?: string, roles?: string[]): UserRole[] {
  const values = roles && roles.length > 0 ? roles : role ? [role] : [];
  const allowed = new Set(Object.values(UserRole) as string[]);
  return Array.from(new Set(values.filter((value) => allowed.has(value)))) as UserRole[];
}

async function getActor(): Promise<SessionActor | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const roles = normalizeRoleList(session?.user?.role, session?.user?.roles);
  if (!userId || roles.length === 0) return null;
  return {
    userId,
    name: session?.user?.name || 'User',
    email: session?.user?.email || '',
    role: (session?.user?.role as UserRole | undefined) ?? roles[0],
    roles,
  };
}

async function assertPayrollAdmin() {
  const actor = await getActor();
  if (!actor || !canAccessPayroll(actor.roles)) throw new Error('Unauthorized');
  return actor;
}

async function assertPayrollPortalUser() {
  const actor = await getActor();
  if (
    !actor ||
    !canAccessPayrollPortal({
      role: actor.role,
      email: actor.email,
      name: actor.name,
    })
  ) {
    throw new Error('Unauthorized');
  }
  return actor;
}

function revalidatePayroll() {
  for (const path of PAYROLL_ADMIN_PATHS) revalidatePath(path);
  revalidatePath(PAYROLL_PORTAL_PATH);
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function percent(value: number) {
  return Math.round(value * 10000) / 10000;
}

function cleanText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function ensurePercent(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return percent(value);
}

function ensureMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return money(value);
}

function datesFromFilters(filters: PayrollRequestFilters | PayrollReportFilters) {
  const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
  const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
  };
}

function serializeRequest(request: Prisma.PayrollCompRequestGetPayload<{ include: typeof requestInclude }>): PayrollRequestRow {
  return {
    id: request.id,
    loanOfficerId: request.loanOfficerId,
    loanOfficerName: request.loanOfficer.name,
    loanOfficerEmail: request.loanOfficer.email,
    loanNumber: request.loanNumber,
    borrowerName: request.borrowerName,
    loanType: request.loanType,
    lender: request.lender,
    loanChannel: request.loanChannel,
    processingType: request.processingType,
    expectedRevenue: decimalToNumber(request.expectedRevenue),
    status: request.status,
    submittedAt: request.submittedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    paidAt: request.paidAt?.toISOString() ?? null,
    submitterNotes: request.submitterNotes,
    adminNotes: request.adminNotes,
    rejectionReason: request.rejectionReason,
    splits: request.splits.map((split) => ({
      id: split.id,
      recipientUserId: split.recipientUserId,
      recipientName: split.recipientName,
      recipientEmail: split.recipientEmail,
      roleLabel: split.roleLabel,
      splitPercent: decimalToNumber(split.splitPercent),
      amount: decimalToNumber(split.amount),
      sortOrder: split.sortOrder,
    })),
  };
}

async function buildSplitSnapshots(loanOfficerId: string, expectedRevenue: number) {
  const [loanOfficer, plan] = await Promise.all([
    prisma.user.findUnique({
      where: { id: loanOfficerId },
      select: { id: true, name: true, email: true },
    }),
    prisma.payrollCompPlan.findFirst({
      where: { loanOfficerId, active: true },
      orderBy: { effectiveStart: 'desc' },
      include: {
        splits: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: { recipientUser: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ]);

  if (!loanOfficer) throw new Error('Loan officer was not found.');

  const rawSplits = plan
    ? [
        {
          planId: plan.id,
          recipientUserId: loanOfficer.id,
          recipientName: loanOfficer.name,
          recipientEmail: loanOfficer.email,
          roleLabel: 'Loan Officer',
          splitPercent: decimalToNumber(plan.baseSplitPercent),
          sortOrder: 0,
        },
        ...plan.splits.map((split, index) => ({
          planId: plan.id,
          recipientUserId: split.recipientUser.id,
          recipientName: split.recipientUser.name,
          recipientEmail: split.recipientUser.email,
          roleLabel: split.roleLabel,
          splitPercent: decimalToNumber(split.splitPercent),
          sortOrder: index + 1,
        })),
      ]
    : [
        {
          planId: null,
          recipientUserId: loanOfficer.id,
          recipientName: loanOfficer.name,
          recipientEmail: loanOfficer.email,
          roleLabel: 'Loan Officer',
          splitPercent: 100,
          sortOrder: 0,
        },
      ];

  const totalPercent = percent(rawSplits.reduce((sum, split) => sum + split.splitPercent, 0));
  if (Math.abs(totalPercent - 100) > 0.0001) {
    throw new Error('Compensation split percentages must add up to 100%.');
  }

  let assigned = 0;
  return rawSplits.map((split, index) => {
    const isLast = index === rawSplits.length - 1;
    const calculated = isLast
      ? money(expectedRevenue - assigned)
      : money((expectedRevenue * split.splitPercent) / 100);
    assigned += calculated;
    return {
      ...split,
      amount: calculated,
    };
  });
}

export async function getPayrollEligibleUsers() {
  await assertPayrollAdmin();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: { in: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
        { roles: { hasSome: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true },
  });
  return users;
}

export async function getPayrollUsersWithPlans(): Promise<PayrollUserPlanRow[]> {
  await assertPayrollAdmin();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: UserRole.LOAN_OFFICER },
        { roles: { has: UserRole.LOAN_OFFICER } },
      ],
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      payrollCompPlans: {
        where: { active: true },
        orderBy: { effectiveStart: 'desc' },
        take: 1,
        include: {
          splits: {
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
            include: { recipientUser: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });

  return users.map((user) => {
    const plan = user.payrollCompPlans[0] ?? null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: plan
        ? {
            id: plan.id,
            baseSplitPercent: decimalToNumber(plan.baseSplitPercent),
            active: plan.active,
            notes: plan.notes,
            updatedAt: plan.updatedAt.toISOString(),
            splits: plan.splits.map((split) => ({
              id: split.id,
              recipientUserId: split.recipientUserId,
              recipientName: split.recipientUser.name,
              recipientEmail: split.recipientUser.email,
              roleLabel: split.roleLabel,
              splitPercent: decimalToNumber(split.splitPercent),
              sortOrder: split.sortOrder,
            })),
          }
        : null,
    };
  });
}

export async function savePayrollCompPlan(input: PayrollCompPlanInput) {
  await assertPayrollAdmin();

  const loanOfficerId = cleanText(input.loanOfficerId, 'Loan officer');
  const baseSplitPercent = ensurePercent(input.baseSplitPercent, 'Base split');
  const splits = input.splits.map((split, index) => ({
    recipientUserId: cleanText(split.recipientUserId, 'Split recipient'),
    roleLabel: cleanText(split.roleLabel, 'Split role'),
    splitPercent: ensurePercent(split.splitPercent, 'Split percent'),
    sortOrder: index + 1,
  }));
  const total = percent(baseSplitPercent + splits.reduce((sum, split) => sum + split.splitPercent, 0));
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error('Compensation split percentages must add up to 100%.');
  }

  const user = await prisma.user.findUnique({
    where: { id: loanOfficerId },
    select: { id: true },
  });
  if (!user) throw new Error('Loan officer was not found.');

  await prisma.$transaction(async (tx) => {
    await tx.payrollCompPlan.updateMany({
      where: { loanOfficerId, active: true },
      data: { active: false, effectiveEnd: new Date() },
    });
    await tx.payrollCompPlan.create({
      data: {
        loanOfficerId,
        baseSplitPercent,
        active: input.active ?? true,
        notes: input.notes?.trim() || null,
        splits: {
          create: splits.map((split) => ({
            recipientUserId: split.recipientUserId,
            roleLabel: split.roleLabel,
            splitPercent: split.splitPercent,
            sortOrder: split.sortOrder,
          })),
        },
      },
    });
  });

  revalidatePayroll();
}

export async function getPayrollRequestPreview(input: PayrollCompRequestInput) {
  const actor = await assertPayrollPortalUser();
  const expectedRevenue = ensureMoney(input.expectedRevenue, 'Expected revenue');
  const snapshots = await buildSplitSnapshots(actor.userId, expectedRevenue);
  return snapshots.map((split) => ({
    recipientName: split.recipientName,
    recipientEmail: split.recipientEmail,
    roleLabel: split.roleLabel,
    splitPercent: split.splitPercent,
    amount: split.amount,
    sortOrder: split.sortOrder,
  }));
}

export async function submitPayrollCompRequest(input: PayrollCompRequestInput) {
  const actor = await assertPayrollPortalUser();
  const expectedRevenue = ensureMoney(input.expectedRevenue, 'Expected revenue');
  const snapshots = await buildSplitSnapshots(actor.userId, expectedRevenue);

  await prisma.payrollCompRequest.create({
    data: {
      loanOfficerId: actor.userId,
      loanNumber: cleanText(input.loanNumber, 'Loan number'),
      borrowerName: cleanText(input.borrowerName, "Borrower's name"),
      loanType: cleanText(input.loanType, 'Loan type'),
      lender: cleanText(input.lender, 'Lender'),
      loanChannel: input.loanChannel,
      processingType: input.processingType,
      expectedRevenue,
      submitterNotes: input.submitterNotes?.trim() || null,
      splits: {
        create: snapshots.map((split) => ({
          planId: split.planId,
          recipientUserId: split.recipientUserId,
          recipientName: split.recipientName,
          recipientEmail: split.recipientEmail,
          roleLabel: split.roleLabel,
          splitPercent: split.splitPercent,
          amount: split.amount,
          sortOrder: split.sortOrder,
        })),
      },
    },
  });

  revalidatePayroll();
}

export async function getMyPayrollPortalData() {
  const actor = await assertPayrollPortalUser();
  const requests = await prisma.payrollCompRequest.findMany({
    where: { loanOfficerId: actor.userId },
    orderBy: { submittedAt: 'desc' },
    include: requestInclude,
  });
  const rows = requests.map(serializeRequest);
  const summary = summarizeRequests(rows);
  return { rows, summary };
}

export async function getPayrollRequests(filters: PayrollRequestFilters = {}) {
  await assertPayrollAdmin();
  const { start, end } = datesFromFilters(filters);
  const search = filters.search?.trim();
  const where: Prisma.PayrollCompRequestWhereInput = {
    ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
    ...(filters.loanOfficerId ? { loanOfficerId: filters.loanOfficerId } : {}),
    ...(start || end
      ? {
          submittedAt: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { loanNumber: { contains: search, mode: 'insensitive' } },
            { borrowerName: { contains: search, mode: 'insensitive' } },
            { lender: { contains: search, mode: 'insensitive' } },
            { loanOfficer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const requests = await prisma.payrollCompRequest.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 500,
    include: requestInclude,
  });
  return requests.map(serializeRequest);
}

async function replaceRequestSplits(requestId: string) {
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { id: true, loanOfficerId: true, expectedRevenue: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  const snapshots = await buildSplitSnapshots(request.loanOfficerId, decimalToNumber(request.expectedRevenue));
  await prisma.$transaction([
    prisma.payrollCompRequestSplit.deleteMany({ where: { requestId } }),
    prisma.payrollCompRequestSplit.createMany({
      data: snapshots.map((split) => ({
        requestId,
        planId: split.planId,
        recipientUserId: split.recipientUserId,
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        splitPercent: split.splitPercent,
        amount: split.amount,
        sortOrder: split.sortOrder,
      })),
    }),
  ]);
}

export async function approvePayrollRequest(requestId: string, adminNotes?: string, recalculate = false) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (
    request.status !== PayrollCompRequestStatus.PENDING_REVIEW &&
    request.status !== PayrollCompRequestStatus.REJECTED
  ) {
    throw new Error('Only pending or rejected requests can be approved.');
  }
  if (recalculate) await replaceRequestSplits(requestId);
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.APPROVED,
      reviewedAt: new Date(),
      reviewedById: actor.userId,
      adminNotes: adminNotes?.trim() || null,
      rejectionReason: null,
    },
  });
  revalidatePayroll();
}

export async function rejectPayrollRequest(requestId: string, rejectionReason: string, adminNotes?: string) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status === PayrollCompRequestStatus.PAID) {
    throw new Error('Paid requests cannot be rejected.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedById: actor.userId,
      rejectionReason: cleanText(rejectionReason, 'Rejection reason'),
      adminNotes: adminNotes?.trim() || null,
    },
  });
  revalidatePayroll();
}

export async function markPayrollRequestPaid(requestId: string, adminNotes?: string) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status !== PayrollCompRequestStatus.APPROVED) {
    throw new Error('Only approved requests can be marked paid.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.PAID,
      paidAt: new Date(),
      paidById: actor.userId,
      adminNotes: adminNotes?.trim() || undefined,
    },
  });
  revalidatePayroll();
}

export async function reopenPayrollRequest(requestId: string) {
  await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status !== PayrollCompRequestStatus.APPROVED) {
    throw new Error('Only approved requests can be reopened before payment.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.PENDING_REVIEW,
      reviewedAt: null,
      reviewedById: null,
    },
  });
  revalidatePayroll();
}

function summarizeRequests(rows: PayrollRequestRow[]) {
  const empty = {
    totalRequests: rows.length,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    paidCount: 0,
    submittedRevenue: 0,
    pendingRevenue: 0,
    approvedRevenue: 0,
    paidRevenue: 0,
  };

  for (const row of rows) {
    empty.submittedRevenue = money(empty.submittedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PENDING_REVIEW) {
      empty.pendingCount += 1;
      empty.pendingRevenue = money(empty.pendingRevenue + row.expectedRevenue);
    }
    if (row.status === PayrollCompRequestStatus.APPROVED) {
      empty.approvedCount += 1;
      empty.approvedRevenue = money(empty.approvedRevenue + row.expectedRevenue);
    }
    if (row.status === PayrollCompRequestStatus.REJECTED) empty.rejectedCount += 1;
    if (row.status === PayrollCompRequestStatus.PAID) {
      empty.paidCount += 1;
      empty.paidRevenue = money(empty.paidRevenue + row.expectedRevenue);
    }
  }
  return empty;
}

export async function getPayrollAdminDashboardData() {
  await assertPayrollAdmin();
  const rows = await getPayrollRequests({});
  return {
    summary: summarizeRequests(rows),
    pendingRequests: rows.filter((row) => row.status === PayrollCompRequestStatus.PENDING_REVIEW).slice(0, 8),
    recentRequests: rows.slice(0, 8),
  };
}

export async function getPayrollReport(filters: PayrollReportFilters = {}) {
  await assertPayrollAdmin();
  const rows = await getPayrollRequests(filters);
  const summary = summarizeRequests(rows);
  const byLoanOfficer = new Map<string, {
    loanOfficerId: string;
    loanOfficerName: string;
    requestCount: number;
    expectedRevenue: number;
    paidRevenue: number;
  }>();
  const splitRows = new Map<string, {
    recipientName: string;
    recipientEmail: string | null;
    roleLabel: string;
    amount: number;
    requestCount: number;
  }>();

  for (const row of rows) {
    const officer = byLoanOfficer.get(row.loanOfficerId) ?? {
      loanOfficerId: row.loanOfficerId,
      loanOfficerName: row.loanOfficerName,
      requestCount: 0,
      expectedRevenue: 0,
      paidRevenue: 0,
    };
    officer.requestCount += 1;
    officer.expectedRevenue = money(officer.expectedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PAID) {
      officer.paidRevenue = money(officer.paidRevenue + row.expectedRevenue);
    }
    byLoanOfficer.set(row.loanOfficerId, officer);

    for (const split of row.splits) {
      const key = `${split.recipientEmail ?? split.recipientName}:${split.roleLabel}`;
      const current = splitRows.get(key) ?? {
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        amount: 0,
        requestCount: 0,
      };
      current.amount = money(current.amount + split.amount);
      current.requestCount += 1;
      splitRows.set(key, current);
    }
  }

  return {
    summary,
    byLoanOfficer: Array.from(byLoanOfficer.values()).sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    splitRows: Array.from(splitRows.values()).sort((a, b) => b.amount - a.amount),
    detailRows: rows,
  };
}

export async function getPayrollFilterOptions() {
  await assertPayrollAdmin();
  const loanOfficers = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: UserRole.LOAN_OFFICER },
        { roles: { has: UserRole.LOAN_OFFICER } },
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true },
  });
  return { loanOfficers };
}
