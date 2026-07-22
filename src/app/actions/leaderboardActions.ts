'use server';

import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  PayrollCompRequestStatus,
  PayrollLeadSource,
  Prisma,
  TaskKind,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { hasAnyAdminRole, isAdmin } from '@/lib/adminTiers';
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

export type LeaderboardLenderRow = {
  lenderKey: string;
  lenderName: string;
  plusOne: LeaderboardMetric;
  disclosures: LeaderboardMetric;
  processing: LeaderboardMetric;
  fundings: LeaderboardMetric;
};

export type LeaderboardLeadSourceRow = {
  leadSourceKey: string;
  leadSourceName: string;
  plusOne: LeaderboardMetric;
  disclosures: LeaderboardMetric;
  processing: LeaderboardMetric;
  fundings: LeaderboardMetric;
};

export type LeaderboardTeamOption = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  colors: string[];
  memberCount: number;
  memberIds: string[];
};

export type LeaderboardLoanOfficerOption = {
  id: string;
  name: string;
  email: string;
};

export type LeaderboardDetailRow = {
  id: string;
  loanId: string | null;
  creditedLoanOfficerId: string;
  primaryLoanOfficerId: string;
  secondaryLoanOfficerId: string | null;
  lenderKey: string;
  lenderName: string;
  leadSourceKey: string;
  leadSourceName: string;
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
  canEdit: boolean;
  currentUserId: string;
  rows: LeaderboardOfficerRow[];
  lenderRows: LeaderboardLenderRow[];
  leadSourceRows: LeaderboardLeadSourceRow[];
  teams: LeaderboardTeamOption[];
  loanOfficerOptions: LeaderboardLoanOfficerOption[];
  detailRows: LeaderboardDetailRow[];
  totals: {
    plusOne: LeaderboardMetric;
    disclosures: LeaderboardMetric;
    processing: LeaderboardMetric;
    fundings: LeaderboardMetric;
  };
};

export type LeaderboardEditInput = {
  id: string;
  milestone: LeaderboardMilestoneKey;
  loanId?: string | null;
  borrowerName: string;
  loanNumber: string;
  primaryLoanOfficerId: string;
  secondaryLoanOfficerId?: string | null;
  loanAmount: string;
  revenue?: string | null;
  lender: string;
  leadSource: string;
  reason?: string | null;
};

export type LeaderboardEditResult = {
  success: boolean;
  error?: string;
};

export type LeaderboardFallOutRow = {
  taskId: string;
  loanId: string;
  ariveNumber: string;
  borrowerName: string;
  plusOneSubmittedAt: string;
  daysSincePlusOne: number;
  loanAmount: number;
  projectedRevenue: number;
  loanOfficerName: string;
  primaryLoanOfficerName: string;
  secondaryLoanOfficerName: string | null;
  lender: string;
  leadSource: string;
  status: string;
};

export type LeaderboardFallOutReport = {
  filters: {
    preset: LeaderboardRangePreset;
    startDate: string;
    endDate: string;
  };
  generatedAt: string;
  rows: LeaderboardFallOutRow[];
};

export type LeaderboardWaterfallRow = LeaderboardFallOutRow & {
  processingTaskId: string;
  processingSubmittedAt: string;
  daysToProcessing: number;
  processingStatus: string;
};

export type LeaderboardWaterfallReport = {
  filters: {
    preset: LeaderboardRangePreset;
    startDate: string;
    endDate: string;
  };
  generatedAt: string;
  rows: LeaderboardWaterfallRow[];
};

const PROCESSING_KINDS = [TaskKind.SUBMIT_PROCESSING, TaskKind.SUBMIT_QC];

const MILESTONE_LABELS: Record<LeaderboardMilestoneKey, string> = {
  plusOne: '+1s',
  disclosures: 'Disclosures',
  processing: 'Submitted to Processing/QC',
  fundings: 'Fundings',
};

const LEADERBOARD_TIME_ZONE = 'America/Los_Angeles';

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

function parseDateInput(value: string): CalendarDateParts {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return { year, month, day };
}

function getCalendarDatePartsInPortalTime(date: Date): CalendarDateParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
  };
}

function getPortalTimeZoneOffsetMs(date: Date) {
  const roundedDate = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(roundedDate);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const portalAsUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second')
  );
  return portalAsUtc - roundedDate.getTime();
}

function portalDateTimeToUtc(
  parts: CalendarDateParts,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
) {
  const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, second, millisecond));
  const firstPass = new Date(utcGuess.getTime() - getPortalTimeZoneOffsetMs(utcGuess));
  return new Date(utcGuess.getTime() - getPortalTimeZoneOffsetMs(firstPass));
}

function portalStartOfDay(parts: CalendarDateParts) {
  return portalDateTimeToUtc(parts, 0, 0, 0, 0);
}

function portalEndOfDay(parts: CalendarDateParts) {
  return portalDateTimeToUtc(parts, 23, 59, 59, 999);
}

function addCalendarDays(parts: CalendarDateParts, days: number): CalendarDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function resolveDateRange(filters: LeaderboardReportFilters = {}) {
  const preset = filters.preset || 'monthly';
  const now = new Date();
  const today = getCalendarDatePartsInPortalTime(now);
  const todayStart = portalStartOfDay(today);
  const todayEnd = portalEndOfDay(today);

  if (preset === 'custom' && filters.startDate && filters.endDate) {
    const customStart = parseDateInput(filters.startDate);
    const customEnd = parseDateInput(filters.endDate);
    return {
      preset,
      start: portalStartOfDay(customStart),
      end: portalEndOfDay(customEnd),
    };
  }

  if (preset === 'daily') {
    return { preset, start: todayStart, end: todayEnd };
  }

  if (preset === 'weekly') {
    return { preset, start: portalStartOfDay(addCalendarDays(today, -6)), end: todayEnd };
  }

  if (preset === 'ytd') {
    return {
      preset,
      start: portalStartOfDay({ year: today.year, month: 1, day: 1 }),
      end: todayEnd,
    };
  }

  if (preset === 'allTime') {
    return {
      preset,
      start: portalStartOfDay({ year: 2020, month: 1, day: 1 }),
      end: todayEnd,
    };
  }

  return {
    preset: 'monthly' as const,
    start: portalStartOfDay({ year: today.year, month: today.month, day: 1 }),
    end: todayEnd,
  };
}

function money(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const normalized =
    typeof value === 'string'
      ? value.replace(/[$,\s]/g, '').trim()
      : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRole(role?: string | UserRole | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

async function getLeaderboardSessionUser() {
  const session = await getServerSession(authOptions);
  const role = normalizeRole(session?.user?.activeRole || session?.user?.role);
  const roles = Array.isArray(session?.user?.roles)
    ? session.user.roles.map((userRole) => normalizeRole(userRole)).filter((userRole): userRole is UserRole => Boolean(userRole))
    : [];
  return {
    session,
    role,
    isAdminUser: Boolean((role && isAdmin(role)) || hasAnyAdminRole(roles)),
    userId: session?.user?.id || null,
    name: session?.user?.name || 'Admin',
  };
}

function splitBorrowerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function formatMoneyForSubmission(value: number) {
  return String(Math.round(value * 100) / 100);
}

function parsePositiveMoney(value: unknown, label: string) {
  const parsed = money(String(value ?? ''));
  if (parsed === null || parsed <= 0) {
    throw new Error(`${label} must be greater than $0.`);
  }
  return parsed;
}

function payrollLeadSourceFromDisplay(value: string) {
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (Object.values(PayrollLeadSource) as string[]).includes(key)
    ? (key as PayrollLeadSource)
    : PayrollLeadSource.OTHER;
}

function normalizeAriveNumber(value: string | null | undefined) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
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

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function lenderFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw =
    data.lender ??
    data.lenderName ??
    data.investor ??
    data.investorName ??
    data.loanInvestor;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function loanNumberFromJson(value: unknown) {
  const data = submissionObject(value);
  if (!data) return null;
  const raw = data.arriveLoanNumber ?? data.loanNumber ?? data.ariveNumber;
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

function lenderKey(name: string | null | undefined) {
  const normalized = String(name || 'Unspecified lender')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return normalized || 'unspecified lender';
}

function lenderDisplayName(name: string | null | undefined) {
  const trimmed = String(name || '').trim();
  return trimmed || 'Unspecified lender';
}

function emptyLenderRow(name: string): LeaderboardLenderRow {
  return {
    lenderKey: lenderKey(name),
    lenderName: lenderDisplayName(name),
    plusOne: emptyMetric(),
    disclosures: emptyMetric(),
    processing: emptyMetric(),
    fundings: emptyMetric(),
  };
}

function leadSourceKey(name: string | null | undefined) {
  const normalized = String(name || 'Unspecified lead source')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return normalized || 'unspecified lead source';
}

function leadSourceDisplayName(name: string | null | undefined) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Unspecified lead source';
  return trimmed.includes('_') || trimmed === trimmed.toUpperCase()
    ? titleCase(trimmed)
    : trimmed;
}

function emptyLeadSourceRow(name: string): LeaderboardLeadSourceRow {
  return {
    leadSourceKey: leadSourceKey(name),
    leadSourceName: leadSourceDisplayName(name),
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
  row: LeaderboardOfficerRow | LeaderboardLenderRow | LeaderboardLeadSourceRow,
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

function getOrCreateLenderRow(map: Map<string, LeaderboardLenderRow>, rawName: string | null | undefined) {
  const displayName = lenderDisplayName(rawName);
  const key = lenderKey(displayName);
  const existing = map.get(key);
  if (existing) return existing;
  const row = emptyLenderRow(displayName);
  map.set(key, row);
  return row;
}

function getOrCreateLeadSourceRow(map: Map<string, LeaderboardLeadSourceRow>, rawName: string | null | undefined) {
  const displayName = leadSourceDisplayName(rawName);
  const key = leadSourceKey(displayName);
  const existing = map.get(key);
  if (existing) return existing;
  const row = emptyLeadSourceRow(displayName);
  map.set(key, row);
  return row;
}

export async function getLeaderboardReport(
  filters: LeaderboardReportFilters = {}
): Promise<LeaderboardReport> {
  const { session, role, isAdminUser, userId } = await getLeaderboardSessionUser();
  if (
    !session?.user?.id ||
    !canAccessLeaderboardPortal({
      role,
      email: session.user.email,
      name: session.user.name,
    })
  ) {
    throw new Error('Unauthorized');
  }

  const { preset, start, end } = resolveDateRange(filters);
  const dateWhere = { createdAt: { gte: start, lte: end } };

  const [loanOfficers, teams, taskRows, fundingRows] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        OR: [{ role: UserRole.LOAN_OFFICER }, { roles: { has: UserRole.LOAN_OFFICER } }],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
    prisma.leadUserTeam.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        colors: true,
        members: { select: { userId: true } },
      },
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
        leadSource: true,
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
  const lenderMap = new Map<string, LeaderboardLenderRow>();
  const leadSourceMap = new Map<string, LeaderboardLeadSourceRow>();

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
    const lenderName = lenderDisplayName(lenderFromJson(task.submissionData));
    const lenderRow = getOrCreateLenderRow(lenderMap, lenderName);
    const leadSourceRow = getOrCreateLeadSourceRow(leadSourceMap, leadSourceFromJson(task.submissionData));
    addMetric(row, milestone, amount, revenue);
    addMetric(lenderRow, milestone, amount, revenue);
    addMetric(leadSourceRow, milestone, amount, revenue);

    detailRows.push({
      id: task.id,
      loanId: task.loan.id,
      creditedLoanOfficerId,
      primaryLoanOfficerId: task.loan.loanOfficerId,
      secondaryLoanOfficerId: task.loan.secondaryLoanOfficerId || null,
      lenderKey: lenderRow.lenderKey,
      lenderName: lenderRow.lenderName,
      leadSourceKey: leadSourceRow.leadSourceKey,
      leadSourceName: leadSourceRow.leadSourceName,
      milestone,
      milestoneLabel: MILESTONE_LABELS[milestone],
      borrowerName: task.loan.borrowerName,
      loanNumber: task.loan.loanNumber,
      amount,
      revenue: milestone === 'plusOne' || milestone === 'processing' ? revenue : null,
      leadSource: leadSourceRow.leadSourceName,
      lender: lenderRow.lenderName,
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
    const lenderRow = getOrCreateLenderRow(lenderMap, funding.lender);
    const leadSourceRow = getOrCreateLeadSourceRow(leadSourceMap, funding.leadSource);
    addMetric(row, 'fundings', amount, revenue);
    addMetric(lenderRow, 'fundings', amount, revenue);
    addMetric(leadSourceRow, 'fundings', amount, revenue);

    detailRows.push({
      id: funding.id,
      loanId: funding.loan?.id || funding.loanId,
      creditedLoanOfficerId,
      primaryLoanOfficerId: funding.loan?.loanOfficerId || funding.loanOfficerId,
      secondaryLoanOfficerId: funding.loan?.secondaryLoanOfficerId || null,
      lenderKey: lenderRow.lenderKey,
      lenderName: lenderRow.lenderName,
      leadSourceKey: leadSourceRow.leadSourceKey,
      leadSourceName: leadSourceRow.leadSourceName,
      milestone: 'fundings',
      milestoneLabel: MILESTONE_LABELS.fundings,
      borrowerName: funding.borrowerName,
      loanNumber: funding.loanNumber,
      amount,
      revenue,
      leadSource: leadSourceRow.leadSourceName,
      lender: lenderRow.lenderName,
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
  const lenderRows = Array.from(lenderMap.values()).sort(
    (a, b) =>
      b.plusOne.volume - a.plusOne.volume ||
      b.processing.volume - a.processing.volume ||
      a.lenderName.localeCompare(b.lenderName)
  );
  const leadSourceRows = Array.from(leadSourceMap.values()).sort(
    (a, b) =>
      b.plusOne.volume - a.plusOne.volume ||
      b.processing.volume - a.processing.volume ||
      a.leadSourceName.localeCompare(b.leadSourceName)
  );

  return {
    filters: {
      preset,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    generatedAt: new Date().toISOString(),
    canEdit: isAdminUser,
    currentUserId: userId || '',
    rows,
    lenderRows,
    leadSourceRows,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      color: team.color,
      colors: team.colors?.length ? team.colors : [team.color],
      memberCount: team.members.length,
      memberIds: team.members.map((member) => member.userId),
    })),
    loanOfficerOptions: loanOfficers.map((officer) => ({
      id: officer.id,
      name: officer.name,
      email: officer.email,
    })),
    detailRows: detailRows
      .filter((row) => isAdminUser || row.creditedLoanOfficerId === userId)
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()),
    totals: {
      plusOne: metricTotals(rows, 'plusOne'),
      disclosures: metricTotals(rows, 'disclosures'),
      processing: metricTotals(rows, 'processing'),
      fundings: metricTotals(rows, 'fundings'),
    },
  };
}

export async function getLeaderboardFallOutReport(
  filters: LeaderboardReportFilters = {}
): Promise<LeaderboardFallOutReport> {
  const { session, isAdminUser } = await getLeaderboardSessionUser();
  if (!session?.user?.id || !isAdminUser) {
    throw new Error('Unauthorized');
  }

  const { preset, start, end } = resolveDateRange(filters);
  const plusOneRows = await prisma.task.findMany({
    where: {
      kind: TaskKind.SUBMIT_PLUS_ONE,
      createdAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      submissionData: true,
      loan: {
        select: {
          id: true,
          loanNumber: true,
          borrowerName: true,
          amount: true,
          loanOfficer: { select: { name: true } },
          secondaryLoanOfficer: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const plusOneLoanIds = Array.from(new Set(plusOneRows.map((row) => row.loan.id)));
  const plusOneRawNumbers = Array.from(new Set(
    plusOneRows
      .flatMap((row) => [loanNumberFromJson(row.submissionData), row.loan.loanNumber])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));
  const processingRows = plusOneRows.length
    ? await prisma.task.findMany({
        where: {
          kind: { in: PROCESSING_KINDS },
          OR: [
            { loanId: { in: plusOneLoanIds } },
            { loan: { loanNumber: { in: plusOneRawNumbers } } },
          ],
        },
        select: {
          loanId: true,
          submissionData: true,
          loan: { select: { loanNumber: true } },
        },
      })
    : [];

  const processedLoanIds = new Set(processingRows.map((row) => row.loanId).filter(Boolean));
  const processedNumbers = new Set(
    processingRows
      .flatMap((row) => [
        normalizeAriveNumber(row.loan?.loanNumber),
        normalizeAriveNumber(loanNumberFromJson(row.submissionData)),
      ])
      .filter(Boolean)
  );
  const now = new Date();

  return {
    filters: {
      preset,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    generatedAt: now.toISOString(),
    rows: plusOneRows
      .filter((row) => {
        const ariveNumber = normalizeAriveNumber(loanNumberFromJson(row.submissionData) || row.loan.loanNumber);
        return !processedLoanIds.has(row.loan.id) && !processedNumbers.has(ariveNumber);
      })
      .map((row) => {
        const ariveNumber = loanNumberFromJson(row.submissionData) || row.loan.loanNumber;
        const submittedAt = row.createdAt;
        return {
          taskId: row.id,
          loanId: row.loan.id,
          ariveNumber,
          borrowerName: row.loan.borrowerName,
          plusOneSubmittedAt: submittedAt.toISOString(),
          daysSincePlusOne: Math.max(
            0,
            Math.floor((now.getTime() - submittedAt.getTime()) / (24 * 60 * 60 * 1000))
          ),
          loanAmount: money(row.loan.amount) || 0,
          projectedRevenue: projectedRevenueFromJson(row.submissionData) || 0,
          loanOfficerName: row.loan.secondaryLoanOfficer?.name || row.loan.loanOfficer.name,
          primaryLoanOfficerName: row.loan.loanOfficer.name,
          secondaryLoanOfficerName: row.loan.secondaryLoanOfficer?.name || null,
          lender: lenderDisplayName(lenderFromJson(row.submissionData)),
          leadSource: leadSourceDisplayName(leadSourceFromJson(row.submissionData)),
          status: row.status,
        };
      }),
  };
}

export async function getLeaderboardWaterfallReport(
  filters: LeaderboardReportFilters = {}
): Promise<LeaderboardWaterfallReport> {
  const { session, isAdminUser } = await getLeaderboardSessionUser();
  if (!session?.user?.id || !isAdminUser) {
    throw new Error('Unauthorized');
  }

  const { preset, start, end } = resolveDateRange(filters);
  const plusOneRows = await prisma.task.findMany({
    where: {
      kind: TaskKind.SUBMIT_PLUS_ONE,
      createdAt: { gte: start, lte: end },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      submissionData: true,
      loan: {
        select: {
          id: true,
          loanNumber: true,
          borrowerName: true,
          amount: true,
          loanOfficer: { select: { name: true } },
          secondaryLoanOfficer: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const plusOneLoanIds = Array.from(new Set(plusOneRows.map((row) => row.loan.id)));
  const plusOneRawNumbers = Array.from(new Set(
    plusOneRows
      .flatMap((row) => [loanNumberFromJson(row.submissionData), row.loan.loanNumber])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));

  const processingRows = plusOneRows.length
    ? await prisma.task.findMany({
        where: {
          kind: { in: PROCESSING_KINDS },
          OR: [
            { loanId: { in: plusOneLoanIds } },
            { loan: { loanNumber: { in: plusOneRawNumbers } } },
          ],
        },
        select: {
          id: true,
          loanId: true,
          status: true,
          createdAt: true,
          submissionData: true,
          loan: { select: { loanNumber: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const processingByLoanId = new Map<string, (typeof processingRows)[number]>();
  const processingByNumber = new Map<string, (typeof processingRows)[number]>();
  for (const processing of processingRows) {
    if (processing.loanId && !processingByLoanId.has(processing.loanId)) {
      processingByLoanId.set(processing.loanId, processing);
    }
    for (const value of [
      normalizeAriveNumber(processing.loan?.loanNumber),
      normalizeAriveNumber(loanNumberFromJson(processing.submissionData)),
    ]) {
      if (value && !processingByNumber.has(value)) {
        processingByNumber.set(value, processing);
      }
    }
  }
  const now = new Date();

  return {
    filters: {
      preset,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    },
    generatedAt: now.toISOString(),
    rows: plusOneRows.flatMap((row) => {
      const normalizedAriveNumber = normalizeAriveNumber(
        loanNumberFromJson(row.submissionData) || row.loan.loanNumber
      );
      const processing = processingByNumber.get(normalizedAriveNumber) || processingByLoanId.get(row.loan.id);
      if (!processing) return [];

      const ariveNumber = loanNumberFromJson(row.submissionData) || row.loan.loanNumber;
      const plusOneSubmittedAt = row.createdAt;
      const processingSubmittedAt = processing.createdAt;
      return [{
        taskId: row.id,
        loanId: row.loan.id,
        ariveNumber,
        borrowerName: row.loan.borrowerName,
        plusOneSubmittedAt: plusOneSubmittedAt.toISOString(),
        daysSincePlusOne: Math.max(
          0,
          Math.floor((now.getTime() - plusOneSubmittedAt.getTime()) / (24 * 60 * 60 * 1000))
        ),
        loanAmount: money(row.loan.amount) || 0,
        projectedRevenue: projectedRevenueFromJson(row.submissionData) || 0,
        loanOfficerName: row.loan.secondaryLoanOfficer?.name || row.loan.loanOfficer.name,
        primaryLoanOfficerName: row.loan.loanOfficer.name,
        secondaryLoanOfficerName: row.loan.secondaryLoanOfficer?.name || null,
        lender: lenderDisplayName(lenderFromJson(row.submissionData)),
        leadSource: leadSourceDisplayName(leadSourceFromJson(row.submissionData)),
        status: row.status,
        processingTaskId: processing.id,
        processingSubmittedAt: processingSubmittedAt.toISOString(),
        daysToProcessing: Math.max(
          0,
          Math.floor((processingSubmittedAt.getTime() - plusOneSubmittedAt.getTime()) / (24 * 60 * 60 * 1000))
        ),
        processingStatus: processing.status,
      }];
    }),
  };
}

function hasLoanOfficerRole(user: { role: UserRole; roles: UserRole[] } | null | undefined) {
  return Boolean(
    user &&
      (user.role === UserRole.LOAN_OFFICER || user.roles.includes(UserRole.LOAN_OFFICER))
  );
}

function serializeForAudit(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, item) => (
    typeof item === 'bigint' ? item.toString() : item
  )));
}

export async function updateLeaderboardLoanDetails(
  input: LeaderboardEditInput
): Promise<LeaderboardEditResult> {
  const { session, userId, isAdminUser, name: actorName } = await getLeaderboardSessionUser();
  if (!session?.user?.id || !userId || !isAdminUser) {
    return { success: false, error: 'Only admins can edit leaderboard loan details.' };
  }

  const borrowerName = input.borrowerName.trim();
  const loanNumber = input.loanNumber.trim();
  const primaryLoanOfficerId = input.primaryLoanOfficerId.trim();
  const secondaryLoanOfficerId = input.secondaryLoanOfficerId?.trim() || null;
  const lender = input.lender.trim();
  const leadSource = input.leadSource.trim();
  const shouldUpdateRevenue =
    input.milestone === 'plusOne' ||
    input.milestone === 'processing' ||
    input.milestone === 'fundings';
  let loanAmount: number;
  let revenue: number | null = null;
  try {
    loanAmount = parsePositiveMoney(input.loanAmount, 'Loan amount');
    revenue = shouldUpdateRevenue ? parsePositiveMoney(input.revenue, 'Revenue') : null;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Please enter valid dollar amounts.',
    };
  }

  if (!borrowerName) return { success: false, error: 'Borrower name is required.' };
  if (!loanNumber) return { success: false, error: 'Loan number is required.' };
  if (!primaryLoanOfficerId) return { success: false, error: 'Primary loan officer is required.' };
  if (secondaryLoanOfficerId && secondaryLoanOfficerId === primaryLoanOfficerId) {
    return { success: false, error: 'Primary and secondary loan officers must be different.' };
  }
  if (!lender) return { success: false, error: 'Lender is required.' };
  if (!leadSource) return { success: false, error: 'Lead source is required.' };

  try {
    await prisma.$transaction(async (tx) => {
      const [primaryLoanOfficer, secondaryLoanOfficer] = await Promise.all([
        tx.user.findUnique({
          where: { id: primaryLoanOfficerId },
          select: { id: true, name: true, email: true, role: true, roles: true },
        }),
        secondaryLoanOfficerId
          ? tx.user.findUnique({
              where: { id: secondaryLoanOfficerId },
              select: { id: true, name: true, email: true, role: true, roles: true },
            })
          : Promise.resolve(null),
      ]);

      if (!hasLoanOfficerRole(primaryLoanOfficer)) {
        throw new Error('Selected primary loan officer is invalid.');
      }
      if (secondaryLoanOfficerId && !hasLoanOfficerRole(secondaryLoanOfficer)) {
        throw new Error('Selected secondary loan officer is invalid.');
      }

      const borrowerParts = splitBorrowerName(borrowerName);
      const commonLoanData = {
        borrowerName,
        loanNumber,
        amount: loanAmount,
        loanOfficerId: primaryLoanOfficerId,
        secondaryLoanOfficerId,
      };

      if (input.milestone === 'fundings') {
        const funding = await tx.payrollCompRequest.findUnique({
          where: { id: input.id },
          select: {
            id: true,
            loanId: true,
            loanNumber: true,
            borrowerName: true,
            expectedRevenue: true,
            lender: true,
            leadSource: true,
            loanOfficerId: true,
            loan: {
              select: {
                id: true,
                loanNumber: true,
                borrowerName: true,
                amount: true,
                loanOfficerId: true,
                secondaryLoanOfficerId: true,
              },
            },
          },
        });
        if (!funding) throw new Error('Funding request not found.');

        if (funding.loanId) {
          await tx.loan.update({
            where: { id: funding.loanId },
            data: commonLoanData,
          });
        }

        await tx.payrollCompRequest.update({
          where: { id: funding.id },
          data: {
            borrowerName,
            loanNumber,
            expectedRevenue: revenue || 0,
            lender,
            leadSource: payrollLeadSourceFromDisplay(leadSource),
            loanOfficerId: primaryLoanOfficerId,
            editedAt: new Date(),
            editedById: userId,
          },
        });

        await tx.auditLog.create({
          data: {
            loanId: funding.loanId,
            userId,
            action: 'LEADERBOARD_FUNDING_EDITED',
            details: JSON.stringify({
              editedBy: actorName,
              reason: input.reason?.trim() || null,
              fundingId: funding.id,
              before: serializeForAudit(funding),
              after: {
                ...commonLoanData,
                expectedRevenue: revenue,
                lender,
                leadSource,
              },
            }),
          },
        });
        return;
      }

      const task = await tx.task.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          kind: true,
          submissionData: true,
          loan: {
            select: {
              id: true,
              loanNumber: true,
              borrowerName: true,
              amount: true,
              loanOfficerId: true,
              secondaryLoanOfficerId: true,
            },
          },
        },
      });
      if (!task) throw new Error('Leaderboard task not found.');
      const milestone = taskKindToMilestone(task.kind);
      if (milestone !== input.milestone) {
        throw new Error('The selected task no longer matches this leaderboard row.');
      }

      await tx.loan.update({
        where: { id: task.loan.id },
        data: commonLoanData,
      });

      const submissionData =
        task.submissionData && typeof task.submissionData === 'object' && !Array.isArray(task.submissionData)
          ? { ...(task.submissionData as Record<string, unknown>) }
          : {};
      submissionData.loanOfficer = primaryLoanOfficer?.name || '';
      submissionData.loanOfficerId = primaryLoanOfficerId;
      submissionData.secondaryLoanOfficerId = secondaryLoanOfficerId;
      submissionData.secondaryLoanOfficerName = secondaryLoanOfficer?.name || 'N/A';
      submissionData.arriveLoanNumber = loanNumber;
      submissionData.borrowerFirstName = borrowerParts.firstName;
      submissionData.borrowerLastName = borrowerParts.lastName;
      submissionData.loanAmount = formatMoneyForSubmission(loanAmount);
      submissionData.lender = lender;
      submissionData.investor = lender;
      submissionData.leadSource = leadSource;
      if (revenue !== null) {
        submissionData.projectedRevenue = formatMoneyForSubmission(revenue);
      }

      await tx.task.update({
        where: { id: task.id },
        data: { submissionData: submissionData as Prisma.InputJsonValue },
      });

      await tx.auditLog.create({
        data: {
          loanId: task.loan.id,
          userId,
          action: 'LEADERBOARD_TASK_EDITED',
          details: JSON.stringify({
            editedBy: actorName,
            reason: input.reason?.trim() || null,
            taskId: task.id,
            milestone: input.milestone,
            before: serializeForAudit(task),
            after: {
              ...commonLoanData,
              revenue,
              lender,
              leadSource,
            },
          }),
        },
      });
    });

    revalidatePath('/leaderboard');
    revalidatePath('/pipeline');
    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to update leaderboard loan details:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to update loan details.',
    };
  }
}
