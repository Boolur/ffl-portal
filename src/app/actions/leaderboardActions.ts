'use server';

import { getServerSession } from 'next-auth';
import {
  PayrollCompRequestStatus,
  Prisma,
  TaskKind,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { canAccessLeaderboardPortal } from '@/lib/leaderboardAccess';
import { prisma } from '@/lib/prisma';

export type LeaderboardRangePreset = 'daily' | 'weekly' | 'monthly' | 'ytd' | 'allTime' | 'custom';
export type LeaderboardMilestoneKey = 'plusOne' | 'disclosures' | 'processing' | 'fundings';

export type LeaderboardReportFilters = {
  preset?: LeaderboardRangePreset;
  startDate?: string;
  endDate?: string;
};

export type LeaderboardMetric = {
  volume: number;
  units: number;
  revenue: number;
};

export type LeaderboardOfficerRow = {
  loanOfficerId: string;
  loanOfficerName: string;
  loanOfficerEmail: string;
  plusOne: LeaderboardMetric;
  disclosures: LeaderboardMetric;
  processing: LeaderboardMetric;
  fundings: LeaderboardMetric;
};

export type LeaderboardDetailRow = {
  id: string;
  loanId: string | null;
  creditedLoanOfficerId: string;
  milestone: LeaderboardMilestoneKey;
  milestoneLabel: string;
  borrowerName: string;
  loanNumber: string;
  amount: number | null;
  revenue: number | null;
  leadSource: string | null;
  lender: string | null;
  status: string;
  occurredAt: string;
  primaryLoanOfficerName: string | null;
  secondaryLoanOfficerName: string | null;
  program: string | null;
  propertyAddress: string | null;
};

export type LeaderboardReport = {
  filters: {
    preset: LeaderboardRangePreset;
    startDate: string;
    endDate: string;
  };
  generatedAt: string;
  rows: LeaderboardOfficerRow[];
  detailRows: LeaderboardDetailRow[];
  totals: {
    plusOne: LeaderboardMetric;
    disclosures: LeaderboardMetric;
    processing: LeaderboardMetric;
    fundings: LeaderboardMetric;
  };
};

const PROCESSING_KINDS = [TaskKind.SUBMIT_PROCESSING, TaskKind.SUBMIT_QC];

const MILESTONE_LABELS: Record<LeaderboardMilestoneKey, string> = {
  plusOne: '+1s',
  disclosures: 'Disclosures',
  processing: 'Submitted to Processing/QC',
  fundings: 'Fundings',
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function resolveDateRange(filters: LeaderboardReportFilters = {}) {
  const preset = filters.preset || 'monthly';
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (preset === 'custom' && filters.startDate && filters.endDate) {
    return {
      preset,
      start: startOfDay(new Date(filters.startDate)),
      end: endOfDay(new Date(filters.endDate)),
    };
  }

  if (preset === 'daily') {
    return { preset, start: todayStart, end: todayEnd };
  }

  if (preset === 'weekly') {
    const start = new Date(todayStart);
    start.setDate(start.getDate() - 6);
    return { preset, start, end: todayEnd };
  }

  if (preset === 'ytd') {
    return {
      preset,
      start: startOfDay(new Date(now.getFullYear(), 0, 1)),
      end: todayEnd,
    };
  }

  if (preset === 'allTime') {
    return {
      preset,
      start: startOfDay(new Date(2020, 0, 1)),
      end: todayEnd,
    };
  }

  return {
    preset: 'monthly' as const,
    start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: todayEnd,
  };
}

function money(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function submissionObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function projectedRevenueFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw = data.projectedRevenue ?? data.revenue ?? data.expectedRevenue;
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  return money(raw);
}

function leadSourceFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw = data.leadSource ?? data.lead_source;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function taskKindToMilestone(kind: TaskKind | null): LeaderboardMilestoneKey | null {
  if (kind === TaskKind.SUBMIT_PLUS_ONE) return 'plusOne';
  if (kind === TaskKind.SUBMIT_DISCLOSURES) return 'disclosures';
  if (kind === TaskKind.SUBMIT_PROCESSING || kind === TaskKind.SUBMIT_QC) return 'processing';
  return null;
}

function emptyMetric(): LeaderboardMetric {
  return { volume: 0, units: 0, revenue: 0 };
}

function emptyOfficerRow(officer: { id: string; name: string; email: string }): LeaderboardOfficerRow {
  return {
    loanOfficerId: officer.id,
    loanOfficerName: officer.name,
    loanOfficerEmail: officer.email,
    plusOne: emptyMetric(),
    disclosures: emptyMetric(),
    processing: emptyMetric(),
    fundings: emptyMetric(),
  };
}

function creditLoanOfficerId(loan: {
  loanOfficerId: string;
  secondaryLoanOfficerId?: string | null;
}) {
  return loan.secondaryLoanOfficerId || loan.loanOfficerId;
}

function addMetric(
  row: LeaderboardOfficerRow,
  milestone: LeaderboardMilestoneKey,
  amount: number,
  revenue: number
) {
  row[milestone].volume += amount;
  row[milestone].units += 1;
  row[milestone].revenue += revenue;
}

function metricTotals(rows: LeaderboardOfficerRow[], milestone: LeaderboardMilestoneKey) {
  return rows.reduce<LeaderboardMetric>(
    (total, row) => {
      total.volume += row[milestone].volume;
      total.units += row[milestone].units;
      total.revenue += row[milestone].revenue;
      return total;
    },
    emptyMetric()
  );
}

export async function getLeaderboardReport(
  filters: LeaderboardReportFilters = {}
): Promise<LeaderboardReport> {
  const session = await getServerSession(authOptions);
  if (
    !session?.user?.id ||
    !canAccessLeaderboardPortal({
      role: session.user.activeRole || session.user.role,
      email: session.user.email,
      name: session.user.name,
    })
  ) {
    throw new Error('Unauthorized');
  }

  const { preset, start, end } = resolveDateRange(filters);
  const dateWhere = { createdAt: { gte: start, lte: end } };

  const [loanOfficers, taskRows, fundingRows] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        OR: [{ role: UserRole.LOAN_OFFICER }, { roles: { has: UserRole.LOAN_OFFICER } }],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.findMany({
      where: {
        kind: { in: [TaskKind.SUBMIT_PLUS_ONE, TaskKind.SUBMIT_DISCLOSURES, ...PROCESSING_KINDS] },
        ...dateWhere,
      },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        submissionData: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            amount: true,
            program: true,
            propertyAddress: true,
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            loanOfficer: { select: { name: true } },
            secondaryLoanOfficer: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payrollCompRequest.findMany({
      where: {
        status: PayrollCompRequestStatus.PAID,
        OR: [
          { paidAt: { gte: start, lte: end } },
          {
            paidAt: null,
            submittedAt: { gte: start, lte: end },
          },
        ],
      },
      select: {
        id: true,
        loanId: true,
        loanNumber: true,
        borrowerName: true,
        expectedRevenue: true,
        lender: true,
        status: true,
        paidAt: true,
        submittedAt: true,
        loanOfficerId: true,
        loanOfficer: { select: { name: true } },
        loan: {
          select: {
            id: true,
            amount: true,
            program: true,
            propertyAddress: true,
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            loanOfficer: { select: { name: true } },
            secondaryLoanOfficer: { select: { name: true } },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { submittedAt: 'desc' }],
    }),
  ]);

  const rowMap = new Map<string, LeaderboardOfficerRow>();
  for (const officer of loanOfficers) {
    rowMap.set(officer.id, emptyOfficerRow(officer));
  }

  const detailRows: LeaderboardDetailRow[] = [];

  for (const task of taskRows) {
    const milestone = taskKindToMilestone(task.kind);
    if (!milestone) continue;

    const creditedLoanOfficerId = creditLoanOfficerId(task.loan);
    const row = rowMap.get(creditedLoanOfficerId);
    if (!row) continue;

    const amount = money(task.loan.amount) || 0;
    const revenue =
      milestone === 'plusOne' || milestone === 'processing'
        ? projectedRevenueFromJson(task.submissionData) || 0
        : 0;
    addMetric(row, milestone, amount, revenue);

    detailRows.push({
      id: task.id,
      loanId: task.loan.id,
      creditedLoanOfficerId,
      milestone,
      milestoneLabel: MILESTONE_LABELS[milestone],
      borrowerName: task.loan.borrowerName,
      loanNumber: task.loan.loanNumber,
      amount,
      revenue: milestone === 'plusOne' || milestone === 'processing' ? revenue : null,
      leadSource: leadSourceFromJson(task.submissionData),
      lender: null,
      status: task.status,
      occurredAt: task.createdAt.toISOString(),
      primaryLoanOfficerName: task.loan.loanOfficer.name,
      secondaryLoanOfficerName: task.loan.secondaryLoanOfficer?.name || null,
      program: task.loan.program,
      propertyAddress: task.loan.propertyAddress,
    });
  }

  for (const funding of fundingRows) {
    const creditedLoanOfficerId = funding.loan
      ? creditLoanOfficerId(funding.loan)
      : funding.loanOfficerId;
    const row = rowMap.get(creditedLoanOfficerId);
    if (!row) continue;

    const amount = money(funding.loan?.amount) || 0;
    const revenue = money(funding.expectedRevenue) || 0;
    addMetric(row, 'fundings', amount, revenue);

    detailRows.push({
      id: funding.id,
      loanId: funding.loan?.id || funding.loanId,
      creditedLoanOfficerId,
      milestone: 'fundings',
      milestoneLabel: MILESTONE_LABELS.fundings,
      borrowerName: funding.borrowerName,
      loanNumber: funding.loanNumber,
      amount,
      revenue,
      leadSource: null,
      lender: funding.lender,
      status: funding.status,
      occurredAt: (funding.paidAt || funding.submittedAt).toISOString(),
      primaryLoanOfficerName: funding.loan?.loanOfficer.name || funding.loanOfficer.name,
      secondaryLoanOfficerName: funding.loan?.secondaryLoanOfficer?.name || null,
      program: funding.loan?.program || null,
      propertyAddress: funding.loan?.propertyAddress || null,
    });
  }

  const rows = Array.from(rowMap.values()).sort(
    (a, b) =>
      b.plusOne.volume - a.plusOne.volume ||
      b.plusOne.units - a.plusOne.units ||
      a.loanOfficerName.localeCompare(b.loanOfficerName)
  );

  return {
    filters: {
      preset,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    rows,
    detailRows: detailRows.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    ),
    totals: {
      plusOne: metricTotals(rows, 'plusOne'),
      disclosures: metricTotals(rows, 'disclosures'),
      processing: metricTotals(rows, 'processing'),
      fundings: metricTotals(rows, 'fundings'),
    },
  };
}
