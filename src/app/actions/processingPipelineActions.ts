'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  Prisma,
  PayrollCompRequestStatus,
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { isAdmin } from '@/lib/adminTiers';
import { prisma } from '@/lib/prisma';
import {
  addMonthsClamped,
  calculateDaysInStatus,
  canEditProcessingPipelineMethod,
  getApprovedWithConditionsAt,
  getCdWarningStartsAt,
  getItemOrderedAt,
  getMortgageFirstPaymentDate,
  getProcessingPipelineLockedDefaults,
  getProcessingPipelineAccess,
  isProcessingPipelineFieldLocked,
  parseOptionalBoolean,
  parseOptionalMoney,
} from '@/lib/processingPipeline';
import {
  PROCESSING_METHOD_SELF_PROCESSED,
  PROCESSING_METHOD_THIRD_PARTY,
} from '@/lib/processingRouting';

type Actor = {
  id: string;
  role: UserRole;
  name: string;
  processingAssignmentGroups: string[];
};

async function getActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  if (!id || !role) return null;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { processingAssignmentGroups: true },
  });
  if (!user) return null;
  return {
    id,
    role,
    name: session.user.name || 'Unknown user',
    processingAssignmentGroups: user.processingAssignmentGroups,
  };
}

function scopeWhere(actor: Actor): Prisma.ProcessingPipelineLoanWhereInput {
  const access = getProcessingPipelineAccess(actor.role);
  if (access.scope === 'COMPANY') return { archivedAt: null };
  if (access.scope === 'ASSIGNED') {
    if (actor.role === UserRole.PROCESSOR_JR) {
      return actor.processingAssignmentGroups.length > 0
        ? {
            assignmentGroup: { in: actor.processingAssignmentGroups },
            archivedAt: null,
          }
        : { id: '__NO_ASSIGNED_PROCESSOR__' };
    }
    return { seniorProcessorId: actor.id, archivedAt: null };
  }
  if (access.scope === 'OWN_LOANS') {
    return {
      archivedAt: null,
      loan: {
        OR: [
          { loanOfficerId: actor.id },
          { secondaryLoanOfficerId: actor.id },
          { visibilitySubmitterUserId: actor.id },
        ],
      },
    };
  }
  return { id: '__NO_ACCESS__' };
}

function editableScopeWhere(actor: Actor): Prisma.ProcessingPipelineLoanWhereInput {
  const access = getProcessingPipelineAccess(actor.role);
  if (access.canEdit) return scopeWhere(actor);
  if (actor.role === UserRole.LOAN_OFFICER) {
    return {
      AND: [
        scopeWhere(actor),
        {
          processingMethod: {
            in: [
              PROCESSING_METHOD_SELF_PROCESSED,
              PROCESSING_METHOD_THIRD_PARTY,
            ],
          },
        },
      ],
    };
  }
  return { id: '__NO_EDIT_ACCESS__' };
}

function serializeRow(row: {
  id: string;
  version: number;
  sheet: ProcessingPipelineSheet;
  pipelineStatus: ProcessingPipelineStatus;
  statusChangedAt: Date;
  estimatedSigningAt: Date | null;
  titleStatus: ProcessingItemStatus;
  payoffStatus: ProcessingItemStatus;
  payoffOrderedAt: Date | null;
  hoiStatus: ProcessingItemStatus;
  hoiOrderedAt: Date | null;
  dateAssigned: Date;
  appraisalNeeded: boolean | null;
  appraisalNotes: string | null;
  appraisalOrderedAt: Date | null;
  appraisalBackAt: Date | null;
  cdSent: boolean;
  cdWarningStartsAt: Date | null;
  missingItemsCurrentStatus: string | null;
  extraNotes: string | null;
  restructureNotes: string | null;
  rateLock: boolean;
  rateLockExpiresAt: Date | null;
  rateLockConfirmedAt: Date | null;
  rateLockRequestedAt: Date | null;
  rateLockRequestedById: string | null;
  approvedWithConditionsAt: Date | null;
  loanType: string | null;
  propertyState: string | null;
  lender: string | null;
  leadSource: string | null;
  projectedRevenue: Prisma.Decimal | null;
  finalRevenue: Prisma.Decimal | null;
  fundedAt: Date | null;
  firstPaymentAt: Date | null;
  sixthPaymentAt: Date | null;
  movedAt: Date | null;
  archivedAt: Date | null;
  archivedById: string | null;
  updatedAt: Date;
  assignmentGroup: string | null;
  processingMethod: string | null;
  loan: {
    id: string;
    loanNumber: string;
    borrowerName: string;
    amount: Prisma.Decimal;
    loanOfficer: { id: string; name: string };
    payrollCompRequests: Array<{
      status: PayrollCompRequestStatus;
      expectedRevenue: Prisma.Decimal;
    }>;
  };
  seniorProcessor: { id: string; name: string } | null;
  juniorProcessor: { id: string; name: string } | null;
}) {
  return {
    ...row,
    dateAssigned: row.dateAssigned.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    estimatedSigningAt: row.estimatedSigningAt?.toISOString() || null,
    appraisalOrderedAt: row.appraisalOrderedAt?.toISOString() || null,
    appraisalBackAt: row.appraisalBackAt?.toISOString() || null,
    payoffOrderedAt: row.payoffOrderedAt?.toISOString() || null,
    hoiOrderedAt: row.hoiOrderedAt?.toISOString() || null,
    cdWarningStartsAt: row.cdWarningStartsAt?.toISOString() || null,
    rateLockExpiresAt: row.rateLockExpiresAt?.toISOString() || null,
    rateLockConfirmedAt: row.rateLockConfirmedAt?.toISOString() || null,
    rateLockRequestedAt: row.rateLockRequestedAt?.toISOString() || null,
    approvedWithConditionsAt: row.approvedWithConditionsAt?.toISOString() || null,
    fundedAt: row.fundedAt?.toISOString() || null,
    firstPaymentAt: row.firstPaymentAt?.toISOString() || null,
    sixthPaymentAt: row.sixthPaymentAt?.toISOString() || null,
    movedAt: row.movedAt?.toISOString() || null,
    archivedAt: row.archivedAt?.toISOString() || null,
    updatedAt: row.updatedAt.toISOString(),
    projectedRevenue: row.projectedRevenue === null ? null : Number(row.projectedRevenue),
    finalRevenue: row.finalRevenue === null ? null : Number(row.finalRevenue),
    payrollSubmitted: row.loan.payrollCompRequests.length > 0,
    payrollStatus: row.loan.payrollCompRequests[0]?.status || null,
    daysInStatus: calculateDaysInStatus(row.statusChangedAt),
    loan: {
      ...row.loan,
      amount: Number(row.loan.amount),
    },
  };
}

export type ProcessingPipelineRow = ReturnType<typeof serializeRow> & { canEdit: boolean };

export type ProcessingPipelineFilters = {
  loanOfficerIds?: string[];
  teamLoanOfficerIds?: string[];
  assignedFrom?: string;
  assignedTo?: string;
  loanNumbers?: string[];
  borrowerNames?: string[];
  loanAmountMin?: number;
  loanAmountMax?: number;
  loanTypes?: string[];
  states?: string[];
  lenders?: string[];
  leadSources?: string[];
  juniorProcessorIds?: string[];
  seniorProcessorIds?: string[];
  pipelineStatuses?: ProcessingPipelineStatus[];
  daysInStatusMin?: number;
  daysInStatusMax?: number;
  titleStatuses?: ProcessingItemStatus[];
  payoffStatuses?: ProcessingItemStatus[];
  hoiStatuses?: ProcessingItemStatus[];
  appraisalNeeded?: Array<'YES' | 'NO' | 'BLANK'>;
  appraisalNotes?: string;
  appraisalOrderedFrom?: string;
  appraisalOrderedTo?: string;
  appraisalBackFrom?: string;
  appraisalBackTo?: string;
  cdSent?: Array<'YES' | 'NO' | 'BLANK'>;
  missingItemsCurrentStatus?: string;
  extraNotes?: string;
  restructureNotes?: string;
  rateLock?: Array<'YES' | 'NO' | 'BLANK'>;
  rateLockExpiresFrom?: string;
  rateLockExpiresTo?: string;
  fundedFrom?: string;
  fundedTo?: string;
  estimatedSigningFrom?: string;
  estimatedSigningTo?: string;
  firstPaymentFrom?: string;
  firstPaymentTo?: string;
  sixthPaymentFrom?: string;
  sixthPaymentTo?: string;
  projectedRevenueMin?: number;
  projectedRevenueMax?: number;
  finalRevenueMin?: number;
  finalRevenueMax?: number;
};

function endOfInputDay(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function startOfInputDay(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function nullableBooleanWhere(
  field: 'appraisalNeeded' | 'rateLock' | 'cdSent',
  values?: Array<'YES' | 'NO' | 'BLANK'>,
): Prisma.ProcessingPipelineLoanWhereInput | null {
  if (!values?.length) return null;
  const booleans: boolean[] = [];
  if (values.includes('YES')) booleans.push(true);
  if (values.includes('NO')) booleans.push(false);
  const includeBlank = values.includes('BLANK');
  if (includeBlank && booleans.length > 0) {
    return { OR: [{ [field]: { in: booleans } }, { [field]: null }] };
  }
  return includeBlank ? { [field]: null } : { [field]: { in: booleans } };
}

function processorFilter(
  field: 'juniorProcessorId' | 'seniorProcessorId',
  values?: string[],
): Prisma.ProcessingPipelineLoanWhereInput | null {
  if (!values?.length) return null;
  const ids = values.filter((value) => value !== '__unassigned__');
  const includeUnassigned = values.includes('__unassigned__');
  if (includeUnassigned && ids.length > 0) {
    return { OR: [{ [field]: { in: ids } }, { [field]: null }] };
  }
  return includeUnassigned ? { [field]: null } : { [field]: { in: ids } };
}

function buildFilterWhere(filters?: ProcessingPipelineFilters) {
  if (!filters) return [] as Prisma.ProcessingPipelineLoanWhereInput[];
  const clauses: Prisma.ProcessingPipelineLoanWhereInput[] = [];
  if (filters.loanOfficerIds?.length) {
    clauses.push({ loan: { loanOfficerId: { in: filters.loanOfficerIds } } });
  }
  if (filters.teamLoanOfficerIds?.length) {
    clauses.push({ loan: { loanOfficerId: { in: filters.teamLoanOfficerIds } } });
  }
  if (filters.loanNumbers?.length) {
    clauses.push({ loan: { loanNumber: { in: filters.loanNumbers } } });
  }
  if (filters.borrowerNames?.length) {
    clauses.push({ loan: { borrowerName: { in: filters.borrowerNames } } });
  }
  if (filters.loanAmountMin !== undefined || filters.loanAmountMax !== undefined) {
    clauses.push({
      loan: {
        amount: {
          gte: filters.loanAmountMin,
          lte: filters.loanAmountMax,
        },
      },
    });
  }
  if (filters.loanTypes?.length) clauses.push({ loanType: { in: filters.loanTypes } });
  if (filters.states?.length) clauses.push({ propertyState: { in: filters.states } });
  if (filters.lenders?.length) clauses.push({ lender: { in: filters.lenders } });
  if (filters.leadSources?.length) {
    clauses.push({ leadSource: { in: filters.leadSources } });
  }
  const junior = processorFilter('juniorProcessorId', filters.juniorProcessorIds);
  const senior = processorFilter('seniorProcessorId', filters.seniorProcessorIds);
  if (junior) clauses.push(junior);
  if (senior) clauses.push(senior);
  if (filters.pipelineStatuses?.length) {
    clauses.push({ pipelineStatus: { in: filters.pipelineStatuses } });
  }
  if (filters.titleStatuses?.length) clauses.push({ titleStatus: { in: filters.titleStatuses } });
  if (filters.payoffStatuses?.length) clauses.push({ payoffStatus: { in: filters.payoffStatuses } });
  if (filters.hoiStatuses?.length) clauses.push({ hoiStatus: { in: filters.hoiStatuses } });

  const assignedFrom = startOfInputDay(filters.assignedFrom);
  const assignedTo = endOfInputDay(filters.assignedTo);
  if (assignedFrom || assignedTo) clauses.push({ dateAssigned: { gte: assignedFrom, lte: assignedTo } });
  const appraisalOrderedFrom = startOfInputDay(filters.appraisalOrderedFrom);
  const appraisalOrderedTo = endOfInputDay(filters.appraisalOrderedTo);
  if (appraisalOrderedFrom || appraisalOrderedTo) {
    clauses.push({ appraisalOrderedAt: { gte: appraisalOrderedFrom, lte: appraisalOrderedTo } });
  }
  const appraisalBackFrom = startOfInputDay(filters.appraisalBackFrom);
  const appraisalBackTo = endOfInputDay(filters.appraisalBackTo);
  if (appraisalBackFrom || appraisalBackTo) {
    clauses.push({ appraisalBackAt: { gte: appraisalBackFrom, lte: appraisalBackTo } });
  }
  const rateLockExpiresFrom = startOfInputDay(filters.rateLockExpiresFrom);
  const rateLockExpiresTo = endOfInputDay(filters.rateLockExpiresTo);
  if (rateLockExpiresFrom || rateLockExpiresTo) {
    clauses.push({ rateLockExpiresAt: { gte: rateLockExpiresFrom, lte: rateLockExpiresTo } });
  }
  const fundedFrom = startOfInputDay(filters.fundedFrom);
  const fundedTo = endOfInputDay(filters.fundedTo);
  if (fundedFrom || fundedTo) clauses.push({ fundedAt: { gte: fundedFrom, lte: fundedTo } });
  const estimatedSigningFrom = startOfInputDay(filters.estimatedSigningFrom);
  const estimatedSigningTo = endOfInputDay(filters.estimatedSigningTo);
  if (estimatedSigningFrom || estimatedSigningTo) {
    clauses.push({
      estimatedSigningAt: {
        gte: estimatedSigningFrom,
        lte: estimatedSigningTo,
      },
    });
  }
  const firstPaymentFrom = startOfInputDay(filters.firstPaymentFrom);
  const firstPaymentTo = endOfInputDay(filters.firstPaymentTo);
  if (firstPaymentFrom || firstPaymentTo) {
    clauses.push({ firstPaymentAt: { gte: firstPaymentFrom, lte: firstPaymentTo } });
  }
  const sixthPaymentFrom = startOfInputDay(filters.sixthPaymentFrom);
  const sixthPaymentTo = endOfInputDay(filters.sixthPaymentTo);
  if (sixthPaymentFrom || sixthPaymentTo) {
    clauses.push({ sixthPaymentAt: { gte: sixthPaymentFrom, lte: sixthPaymentTo } });
  }

  if (filters.daysInStatusMin !== undefined || filters.daysInStatusMax !== undefined) {
    const now = Date.now();
    const oldestAllowed = filters.daysInStatusMax === undefined
      ? undefined
      : new Date(now - (filters.daysInStatusMax + 1) * 86_400_000);
    const newestAllowed = filters.daysInStatusMin === undefined
      ? undefined
      : new Date(now - filters.daysInStatusMin * 86_400_000);
    clauses.push({ statusChangedAt: { gt: oldestAllowed, lte: newestAllowed } });
  }

  const appraisalNeeded = nullableBooleanWhere('appraisalNeeded', filters.appraisalNeeded);
  const rateLock = nullableBooleanWhere('rateLock', filters.rateLock);
  const cdSent = nullableBooleanWhere('cdSent', filters.cdSent);
  if (appraisalNeeded) clauses.push(appraisalNeeded);
  if (rateLock) clauses.push(rateLock);
  if (cdSent) clauses.push(cdSent);
  if (filters.appraisalNotes?.trim()) {
    clauses.push({ appraisalNotes: { contains: filters.appraisalNotes.trim(), mode: 'insensitive' } });
  }
  if (filters.missingItemsCurrentStatus?.trim()) {
    clauses.push({
      missingItemsCurrentStatus: {
        contains: filters.missingItemsCurrentStatus.trim(),
        mode: 'insensitive',
      },
    });
  }
  if (filters.extraNotes?.trim()) {
    clauses.push({ extraNotes: { contains: filters.extraNotes.trim(), mode: 'insensitive' } });
  }
  if (filters.restructureNotes?.trim()) {
    clauses.push({ restructureNotes: { contains: filters.restructureNotes.trim(), mode: 'insensitive' } });
  }
  if (filters.projectedRevenueMin !== undefined || filters.projectedRevenueMax !== undefined) {
    clauses.push({
      projectedRevenue: {
        gte: filters.projectedRevenueMin,
        lte: filters.projectedRevenueMax,
      },
    });
  }
  if (filters.finalRevenueMin !== undefined || filters.finalRevenueMax !== undefined) {
    clauses.push({
      finalRevenue: {
        gte: filters.finalRevenueMin,
        lte: filters.finalRevenueMax,
      },
    });
  }
  return clauses;
}

export async function getProcessingPipeline(input?: {
  sheet?: ProcessingPipelineSheet;
  rateLockRequestsOnly?: boolean;
  search?: string;
  sortBy?: 'pipelineStatus' | 'dateAssigned' | 'statusChangedAt' | 'borrowerName' | 'loanNumber';
  sortDirection?: 'asc' | 'desc';
  filters?: ProcessingPipelineFilters;
}) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };
  const rateLockRequestsOnly = input?.rateLockRequestsOnly === true;
  if (
    rateLockRequestsOnly &&
    actor.role !== UserRole.MANAGER &&
    !isAdmin(actor.role)
  ) {
    return { success: false as const, error: 'Rate Lock Requests are limited to Managers and Admins.' };
  }

  const search = input?.search?.trim();
  const where: Prisma.ProcessingPipelineLoanWhereInput = {
    AND: [
      scopeWhere(actor),
      rateLockRequestsOnly
        ? { rateLockRequestedAt: { not: null } }
        : { sheet: input?.sheet || ProcessingPipelineSheet.PIPELINE },
      ...(search
        ? [{
            OR: [
              { loan: { loanNumber: { contains: search, mode: 'insensitive' as const } } },
              { loan: { borrowerName: { contains: search, mode: 'insensitive' as const } } },
              { loan: { loanOfficer: { name: { contains: search, mode: 'insensitive' as const } } } },
              { seniorProcessor: { name: { contains: search, mode: 'insensitive' as const } } },
              { juniorProcessor: { name: { contains: search, mode: 'insensitive' as const } } },
              { lender: { contains: search, mode: 'insensitive' as const } },
            ],
          }]
        : []),
      ...buildFilterWhere(input?.filters),
    ],
  };

  const sortDirection = input?.sortDirection === 'asc' ? 'asc' : 'desc';
  let orderBy:
    | Prisma.ProcessingPipelineLoanOrderByWithRelationInput
    | Prisma.ProcessingPipelineLoanOrderByWithRelationInput[];
  if (input?.sortBy === 'borrowerName') orderBy = { loan: { borrowerName: sortDirection } };
  else if (input?.sortBy === 'loanNumber') orderBy = { loan: { loanNumber: sortDirection } };
  else if (input?.sortBy === 'statusChangedAt') orderBy = { statusChangedAt: sortDirection };
  else if (input?.sortBy === 'dateAssigned') orderBy = { dateAssigned: sortDirection };
  else {
    orderBy = [
      { pipelineStatus: 'asc' },
      { statusChangedAt: 'asc' },
      { dateAssigned: 'desc' },
    ];
  }

  const [rows, total, teams] = await prisma.$transaction([
    prisma.processingPipelineLoan.findMany({
      where,
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            amount: true,
            loanOfficer: { select: { id: true, name: true } },
            payrollCompRequests: {
              where: { status: { not: PayrollCompRequestStatus.REJECTED } },
              orderBy: { submittedAt: 'desc' },
              take: 1,
              select: {
                status: true,
                expectedRevenue: true,
              },
            },
          },
        },
        seniorProcessor: { select: { id: true, name: true } },
        juniorProcessor: { select: { id: true, name: true } },
      },
      orderBy,
    }),
    prisma.processingPipelineLoan.count({ where }),
    prisma.leadUserTeam.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        color: true,
        colors: true,
        members: { select: { userId: true } },
      },
    }),
  ]);

  return {
    success: true as const,
    rows: rows.map((row) => ({
      ...serializeRow(row),
      canEdit: canEditProcessingPipelineMethod(actor.role, row.processingMethod),
    })),
    total,
    page: 1,
    pageSize: Math.max(1, total),
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      color: team.color,
      colors: team.colors?.length ? team.colors : [team.color],
      memberCount: team.members.length,
      memberIds: team.members.map((member) => member.userId),
    })),
    canEdit: access.canEdit || actor.role === UserRole.LOAN_OFFICER,
    role: actor.role,
  };
}

export async function getProcessingPipelineSheetCounts() {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };

  const grouped = await prisma.processingPipelineLoan.groupBy({
    by: ['sheet'],
    where: scopeWhere(actor),
    _count: { _all: true },
  });
  const counts = Object.fromEntries(
    grouped.map((row) => [row.sheet, row._count._all])
  ) as Partial<Record<ProcessingPipelineSheet, number>>;

  return { success: true as const, counts };
}

export async function getProcessingPipelineFilterOptions(
  sheet: ProcessingPipelineSheet,
  rateLockRequestsOnly = false,
) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };
  if (
    rateLockRequestsOnly &&
    actor.role !== UserRole.MANAGER &&
    !isAdmin(actor.role)
  ) {
    return { success: false as const, error: 'Rate Lock Requests are limited to Managers and Admins.' };
  }

  const rows = await prisma.processingPipelineLoan.findMany({
    where: {
      AND: [
        scopeWhere(actor),
        rateLockRequestsOnly
          ? { rateLockRequestedAt: { not: null } }
          : { sheet },
      ],
    },
    select: {
      loanType: true,
      propertyState: true,
      lender: true,
      leadSource: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          loanOfficer: { select: { id: true, name: true } },
        },
      },
      juniorProcessor: { select: { id: true, name: true } },
      seniorProcessor: { select: { id: true, name: true } },
    },
    orderBy: { dateAssigned: 'desc' },
  });

  const uniqueTextOptions = (values: Array<string | null>) =>
    Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  const uniqueUserOptions = (values: Array<{ id: string; name: string } | null>) =>
    Array.from(
      new Map(
        values
          .filter((value): value is { id: string; name: string } => Boolean(value))
          .map((value) => [value.id, { value: value.id, label: value.name }])
      ).values()
    ).sort((a, b) => a.label.localeCompare(b.label));

  return {
    success: true as const,
    options: {
      loanOfficers: uniqueUserOptions(rows.map((row) => row.loan.loanOfficer)),
      loanNumbers: uniqueTextOptions(rows.map((row) => row.loan.loanNumber)),
      borrowerNames: uniqueTextOptions(rows.map((row) => row.loan.borrowerName)),
      loanTypes: uniqueTextOptions(rows.map((row) => row.loanType)),
      states: uniqueTextOptions(rows.map((row) => row.propertyState)),
      lenders: uniqueTextOptions(rows.map((row) => row.lender)),
      leadSources: uniqueTextOptions(rows.map((row) => row.leadSource)),
      juniorProcessors: [
        { value: '__unassigned__', label: 'Unassigned' },
        ...uniqueUserOptions(rows.map((row) => row.juniorProcessor)),
      ],
      seniorProcessors: [
        { value: '__unassigned__', label: 'Unassigned' },
        ...uniqueUserOptions(rows.map((row) => row.seniorProcessor)),
      ],
    },
  };
}

const EDITABLE_FIELDS = [
  'pipelineStatus',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'appraisalNeeded',
  'appraisalNotes',
  'appraisalOrderedAt',
  'appraisalBackAt',
  'estimatedSigningAt',
  'cdSent',
  'missingItemsCurrentStatus',
  'extraNotes',
  'lender',
  'propertyState',
  'finalRevenue',
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

const RESTRUCTURE_PIPELINE_STATUSES = new Set<ProcessingPipelineStatus>([
  ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE,
  ProcessingPipelineStatus.ADVERSE_PENDING,
  ProcessingPipelineStatus.PENDING_APPROVAL,
]);

function appendRestructureNote(
  current: string | null,
  actor: Actor,
  action: string,
  notes: string,
  now: Date,
) {
  const entry = `${now.toISOString()} | ${actor.name} | ${action}\n${notes.trim()}`;
  return current?.trim() ? `${current.trim()}\n\n${entry}` : entry;
}

function normalizeCellValue(field: EditableField, value: unknown) {
  if (field === 'pipelineStatus') {
    if (!Object.values(ProcessingPipelineStatus).includes(value as ProcessingPipelineStatus)) {
      throw new Error('Invalid pipeline status.');
    }
    return value as ProcessingPipelineStatus;
  }
  if (field === 'titleStatus' || field === 'payoffStatus' || field === 'hoiStatus') {
    if (!Object.values(ProcessingItemStatus).includes(value as ProcessingItemStatus)) {
      throw new Error('Invalid item status.');
    }
    return value as ProcessingItemStatus;
  }
  if (field === 'appraisalNeeded' || field === 'cdSent') {
    if (value === null || value === '') return null;
    const parsed = parseOptionalBoolean(value);
    if (parsed === null) throw new Error('Invalid Yes/No value.');
    return parsed;
  }
  if (
    field === 'appraisalOrderedAt' ||
    field === 'appraisalBackAt' ||
    field === 'estimatedSigningAt'
  ) {
    if (!value) return null;
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date.');
    return parsed;
  }
  if (field === 'finalRevenue') {
    if (value === null || value === '') return null;
    const parsed = parseOptionalMoney(value);
    if (parsed === null) throw new Error('Invalid currency value.');
    return parsed;
  }
  if (field === 'propertyState') {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized && !/^[A-Z]{2}$/.test(normalized)) {
      throw new Error('State must be a valid two-letter abbreviation.');
    }
    return normalized || null;
  }
  return String(value ?? '').trim() || null;
}

export async function updateProcessingPipelineCell(input: {
  id: string;
  field: EditableField;
  value: unknown;
  estimatedSigningAt?: string | null;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit && actor.role !== UserRole.LOAN_OFFICER) {
    return { success: false as const, error: 'This pipeline is read-only.' };
  }
  if (!EDITABLE_FIELDS.includes(input.field)) {
    return { success: false as const, error: 'This field cannot be edited.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.processingPipelineLoan.findFirst({
        where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
      });
      if (!current) throw new Error('Pipeline row not found.');
      if (current.sheet === ProcessingPipelineSheet.FUNDING) {
        throw new Error('Funded loans are read-only.');
      }
      if (current.version !== input.version) {
        return { conflict: true as const, version: current.version };
      }
      if (
        (
          input.field === 'titleStatus' ||
          input.field === 'payoffStatus' ||
          input.field === 'hoiStatus' ||
          input.field === 'appraisalNeeded' ||
          input.field === 'cdSent'
        ) &&
        isProcessingPipelineFieldLocked(
          input.field,
          current.lender,
          current.processingMethod,
        )
      ) {
        const rule = getProcessingPipelineLockedDefaults(
          current.lender,
          current.processingMethod,
        );
        throw new Error(
          `${input.field} is locked by the ${rule?.label || 'pipeline'} default rule.`,
        );
      }

      const nextValue = normalizeCellValue(input.field, input.value);
      if (input.field === 'pipelineStatus') {
        const nextStatus = nextValue as ProcessingPipelineStatus;
        if (nextStatus === ProcessingPipelineStatus.FUNDED) {
          throw new Error('Use Move to Fundings so a funded date is recorded.');
        }
        const isRestructureStatus = RESTRUCTURE_PIPELINE_STATUSES.has(nextStatus);
        if (current.sheet === ProcessingPipelineSheet.RESTRUCTURE) {
          throw new Error('Use the Restructure action buttons to change this status.');
        }
        if (isRestructureStatus) {
          throw new Error('That status is not available in this pipeline section.');
        }
      }
      const now = new Date();
      let estimatedSigningAt = current.estimatedSigningAt;
      if (
        input.field === 'pipelineStatus' &&
        nextValue === ProcessingPipelineStatus.DOCS_OUT
      ) {
        const signingDateInput = input.estimatedSigningAt || '';
        const parsedSigningDate = /^\d{4}-\d{2}-\d{2}$/.test(signingDateInput)
          ? new Date(`${signingDateInput}T00:00:00.000Z`)
          : null;
        if (
          !parsedSigningDate ||
          Number.isNaN(parsedSigningDate.getTime()) ||
          parsedSigningDate.toISOString().slice(0, 10) !== signingDateInput
        ) {
          throw new Error('A valid estimated signing date is required for Docs Out.');
        }
        estimatedSigningAt = parsedSigningDate;
      } else if (input.field === 'estimatedSigningAt') {
        estimatedSigningAt = nextValue as Date | null;
      }
      let approvedWithConditionsAt = current.approvedWithConditionsAt;
      let payoffOrderedAt = current.payoffOrderedAt;
      let hoiOrderedAt = current.hoiOrderedAt;
      let lockedDefaultsPatch: Record<string, unknown> = {};
      const data: Prisma.ProcessingPipelineLoanUpdateManyMutationInput = {
        [input.field]: nextValue,
        version: { increment: 1 },
      };
      if (input.field === 'pipelineStatus') {
        data.statusChangedAt = now;
        if (nextValue === ProcessingPipelineStatus.DOCS_OUT) {
          data.estimatedSigningAt = estimatedSigningAt;
        }
        const nextApprovedWithConditionsAt = getApprovedWithConditionsAt(
          nextValue as ProcessingPipelineStatus,
          current.approvedWithConditionsAt,
          now,
        );
        if (nextApprovedWithConditionsAt !== current.approvedWithConditionsAt) {
          approvedWithConditionsAt = nextApprovedWithConditionsAt;
          data.approvedWithConditionsAt = now;
        }
      }
      if (input.field === 'payoffStatus') {
        payoffOrderedAt = getItemOrderedAt(
          nextValue as ProcessingItemStatus,
          current.payoffOrderedAt,
          now,
        );
        data.payoffOrderedAt = payoffOrderedAt;
      }
      if (input.field === 'hoiStatus') {
        hoiOrderedAt = getItemOrderedAt(
          nextValue as ProcessingItemStatus,
          current.hoiOrderedAt,
          now,
        );
        data.hoiOrderedAt = hoiOrderedAt;
      }
      if (input.field === 'lender') {
        const lockedDefaults = getProcessingPipelineLockedDefaults(
          nextValue as string | null,
          current.processingMethod,
        );
        if (lockedDefaults) {
          Object.assign(data, lockedDefaults.values, {
            payoffOrderedAt: null,
            hoiOrderedAt: null,
          });
          payoffOrderedAt = null;
          hoiOrderedAt = null;
          lockedDefaultsPatch = {
            ...lockedDefaults.values,
            payoffOrderedAt: null,
            hoiOrderedAt: null,
          };
          if (lockedDefaults.kind === 'SPECIAL_LENDER') {
            const rateLockConfirmedAt = current.rateLockConfirmedAt ?? now;
            Object.assign(data, {
              cdWarningStartsAt: null,
              rateLockExpiresAt: null,
              rateLockConfirmedAt,
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            });
            Object.assign(lockedDefaultsPatch, {
              cdWarningStartsAt: null,
              rateLockExpiresAt: null,
              rateLockConfirmedAt: rateLockConfirmedAt.toISOString(),
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            });
          }
        }
      }
      const updated = await tx.processingPipelineLoan.updateMany({
        where: { id: current.id, version: input.version },
        data,
      });
      if (updated.count !== 1) return { conflict: true as const, version: current.version };

      const previousValue = current[input.field];
      await tx.auditLog.create({
        data: {
          loanId: current.loanId,
          userId: actor.id,
          action: 'PROCESSING_PIPELINE_FIELD_CHANGED',
          details: JSON.stringify({
            processingPipelineLoanId: current.id,
            field: input.field,
            previousValue: previousValue instanceof Date
              ? previousValue.toISOString()
              : previousValue,
            newValue: nextValue instanceof Date ? nextValue.toISOString() : nextValue,
            estimatedSigningAt:
              input.field === 'pipelineStatus' &&
              nextValue === ProcessingPipelineStatus.DOCS_OUT
                ? estimatedSigningAt?.toISOString() || null
                : undefined,
            lockedDefaultsApplied:
              input.field === 'lender' && Object.keys(lockedDefaultsPatch).length > 0
                ? lockedDefaultsPatch
                : null,
            actorName: actor.name,
          }),
        },
      });
      return {
        conflict: false as const,
        version: input.version + 1,
        patch: {
          approvedWithConditionsAt: approvedWithConditionsAt?.toISOString() || null,
          payoffOrderedAt: payoffOrderedAt?.toISOString() || null,
          hoiOrderedAt: hoiOrderedAt?.toISOString() || null,
          estimatedSigningAt: estimatedSigningAt?.toISOString() || null,
          ...lockedDefaultsPatch,
        },
      };
    });

    if (result.conflict) {
      return {
        success: false as const,
        conflict: true as const,
        version: result.version,
        error: 'This row changed in another session. Refreshing the latest values.',
      };
    }
    return { success: true as const, version: result.version, patch: result.patch };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Unable to save this change.',
    };
  }
}

export async function updateProcessingPipelineRateLock(input: {
  id: string;
  rateLock: boolean;
  expiresAt?: string | null;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit && actor.role !== UserRole.LOAN_OFFICER) {
    return { success: false as const, error: 'This pipeline is read-only.' };
  }

  let expiresAt: Date | null = null;
  if (input.rateLock && input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) {
      return {
        success: false as const,
        error: 'A valid Rate Lock expiration date is required.',
      };
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (expiresAt < today) {
      return {
        success: false as const,
        error: 'Rate Lock expiration cannot be in the past.',
      };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.processingPipelineLoan.findFirst({
        where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
      });
      if (!current) throw new Error('Pipeline row not found.');
      if (current.sheet === ProcessingPipelineSheet.FUNDING) {
        throw new Error('Funded loans are read-only.');
      }
      if (current.version !== input.version) {
        return { conflict: true as const, version: current.version };
      }
      if (
        isProcessingPipelineFieldLocked(
          'rateLock',
          current.lender,
          current.processingMethod,
        )
      ) {
        throw new Error('Rate Lock is controlled by this lender and cannot be changed.');
      }
      if (input.rateLock && !expiresAt) {
        throw new Error('A valid expiration date is required when Rate Lock is Yes.');
      }

      const now = new Date();
      const rateLockConfirmedAt = input.rateLock
        ? current.rateLockConfirmedAt ?? now
        : null;
      const cdWarningStartsAt = getCdWarningStartsAt(
        input.rateLock,
        current.cdWarningStartsAt,
        now,
      );
      const updated = await tx.processingPipelineLoan.updateMany({
        where: { id: current.id, version: input.version },
        data: {
          rateLock: input.rateLock,
          rateLockExpiresAt: expiresAt,
          rateLockConfirmedAt,
          cdWarningStartsAt,
          ...(input.rateLock
            ? {
                rateLockRequestedAt: null,
                rateLockRequestedById: null,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        return { conflict: true as const, version: current.version };
      }

      await tx.auditLog.create({
        data: {
          loanId: current.loanId,
          userId: actor.id,
          action: 'PROCESSING_PIPELINE_RATE_LOCK_CHANGED',
          details: JSON.stringify({
            processingPipelineLoanId: current.id,
            field: 'rateLock',
            previousValue: current.rateLock,
            newValue: input.rateLock,
            previousExpiresAt: current.rateLockExpiresAt?.toISOString() || null,
            newExpiresAt: expiresAt?.toISOString() || null,
            actorName: actor.name,
          }),
        },
      });
      if (input.rateLock && current.rateLockRequestedAt) {
        await tx.auditLog.create({
          data: {
            loanId: current.loanId,
            userId: actor.id,
            action: 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED',
            details: JSON.stringify({
              processingPipelineLoanId: current.id,
              requestedAt: current.rateLockRequestedAt.toISOString(),
              requestedById: current.rateLockRequestedById,
              expiresAt: expiresAt?.toISOString() || null,
              actorName: actor.name,
            }),
          },
        });
      }

      return {
        conflict: false as const,
        version: input.version + 1,
        patch: {
          rateLock: input.rateLock,
          rateLockExpiresAt: expiresAt?.toISOString() || null,
          rateLockConfirmedAt: rateLockConfirmedAt?.toISOString() || null,
          cdWarningStartsAt: cdWarningStartsAt?.toISOString() || null,
          ...(input.rateLock
            ? {
                rateLockRequestedAt: null,
                rateLockRequestedById: null,
              }
            : {}),
        },
      };
    });

    if (result.conflict) {
      return {
        success: false as const,
        conflict: true as const,
        version: result.version,
        error: 'This row changed in another session. Refreshing the latest values.',
      };
    }
    return {
      success: true as const,
      version: result.version,
      patch: result.patch,
    };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Unable to save Rate Lock.',
    };
  }
}

export async function requestProcessingRateLock(input: {
  id: string;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const canRequest =
    actor.role === UserRole.LOAN_OFFICER ||
    actor.role === UserRole.PROCESSOR_JR ||
    actor.role === UserRole.PROCESSOR_SR;
  if (!canRequest) {
    return { success: false as const, error: 'Only Loan Officers and Processors can request a Rate Lock.' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
    });
    if (!current) return { kind: 'error' as const, error: 'Pipeline row not found.' };
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }
    if (current.sheet === ProcessingPipelineSheet.FUNDING) {
      return { kind: 'error' as const, error: 'Funded loans cannot request a Rate Lock.' };
    }
    if (
      isProcessingPipelineFieldLocked(
        'rateLock',
        current.lender,
        current.processingMethod,
      )
    ) {
      return { kind: 'error' as const, error: 'Rate Lock is automatically controlled by this lender.' };
    }
    if (current.rateLock) {
      return { kind: 'error' as const, error: 'This loan already has a confirmed Rate Lock.' };
    }
    if (current.rateLockRequestedAt) {
      return { kind: 'error' as const, error: 'A Rate Lock has already been requested.' };
    }

    const now = new Date();
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        rateLockRequestedAt: now,
        rateLockRequestedById: actor.id,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { kind: 'conflict' as const, version: current.version };
    }
    await tx.auditLog.create({
      data: {
        loanId: current.loanId,
        userId: actor.id,
        action: 'PROCESSING_RATE_LOCK_REQUESTED',
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          requestedAt: now.toISOString(),
          actorName: actor.name,
        }),
      },
    });
    return {
      kind: 'ok' as const,
      version: input.version + 1,
      requestedAt: now.toISOString(),
    };
  });

  if (result.kind === 'error') return { success: false as const, error: result.error };
  if (result.kind === 'conflict') {
    return {
      success: false as const,
      conflict: true as const,
      version: result.version,
      error: 'This row changed in another session. Refreshing the latest values.',
    };
  }
  return {
    success: true as const,
    version: result.version,
    patch: {
      rateLockRequestedAt: result.requestedAt,
      rateLockRequestedById: actor.id,
    },
  };
}

export async function dismissProcessingRateLockRequest(input: {
  id: string;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  if (actor.role !== UserRole.MANAGER && !isAdmin(actor.role)) {
    return { success: false as const, error: 'Only Managers and Admins can dismiss Rate Lock Requests.' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, scopeWhere(actor)] },
    });
    if (!current || !current.rateLockRequestedAt) {
      return { kind: 'error' as const, error: 'Active Rate Lock Request not found.' };
    }
    if (current.sheet === ProcessingPipelineSheet.FUNDING) {
      return { kind: 'error' as const, error: 'Funded loans are read-only.' };
    }
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        rateLockRequestedAt: null,
        rateLockRequestedById: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { kind: 'conflict' as const, version: current.version };
    }
    await tx.auditLog.create({
      data: {
        loanId: current.loanId,
        userId: actor.id,
        action: 'PROCESSING_RATE_LOCK_REQUEST_DISMISSED',
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          requestedAt: current.rateLockRequestedAt.toISOString(),
          requestedById: current.rateLockRequestedById,
          actorName: actor.name,
        }),
      },
    });
    return { kind: 'ok' as const };
  });

  if (result.kind === 'error') return { success: false as const, error: result.error };
  if (result.kind === 'conflict') {
    return {
      success: false as const,
      conflict: true as const,
      version: result.version,
      error: 'This row changed in another session. Refreshing the latest values.',
    };
  }
  return { success: true as const };
}

export async function declineProcessingPipelineLoan(input: {
  id: string;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const canDecline =
    actor.role === UserRole.PROCESSOR_JR ||
    actor.role === UserRole.PROCESSOR_SR ||
    actor.role === UserRole.MANAGER ||
    isAdmin(actor.role);
  if (!canDecline) {
    return { success: false as const, error: 'Only Processors, Managers, and Admins can decline loans.' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
    });
    if (
      !current ||
      current.sheet !== ProcessingPipelineSheet.RESTRUCTURE ||
      current.pipelineStatus !== ProcessingPipelineStatus.ADVERSE_PENDING
    ) {
      return { kind: 'error' as const, error: 'Only Adverse Pending restructure loans can be declined.' };
    }
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }
    const now = new Date();
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        archivedAt: now,
        archivedById: actor.id,
        rateLockRequestedAt: null,
        rateLockRequestedById: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { kind: 'conflict' as const, version: current.version };
    }
    await tx.auditLog.create({
      data: {
        loanId: current.loanId,
        userId: actor.id,
        action: 'PROCESSING_PIPELINE_LOAN_DECLINED',
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          previousStatus: current.pipelineStatus,
          archivedAt: now.toISOString(),
          actorName: actor.name,
        }),
      },
    });
    return { kind: 'ok' as const };
  });

  if (result.kind === 'error') return { success: false as const, error: result.error };
  if (result.kind === 'conflict') {
    return {
      success: false as const,
      conflict: true as const,
      version: result.version,
      error: 'This row changed in another session. Refreshing the latest values.',
    };
  }
  return { success: true as const };
}

export type ProcessingRestructureAction =
  | 'REQUEST_ADVERSE'
  | 'SEND_TO_UNDERWRITING';

export async function updateProcessingRestructureWorkflow(input: {
  id: string;
  action: ProcessingRestructureAction;
  notes: string;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit && actor.role !== UserRole.LOAN_OFFICER) {
    return { success: false as const, error: 'This pipeline is read-only.' };
  }
  const notes = input.notes.trim();
  if (!notes) {
    return { success: false as const, error: 'Restructure notes are required.' };
  }
  if (input.action !== 'REQUEST_ADVERSE' && input.action !== 'SEND_TO_UNDERWRITING') {
    return { success: false as const, error: 'Invalid restructure action.' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
    });
    if (!current || current.sheet !== ProcessingPipelineSheet.RESTRUCTURE) {
      return { kind: 'error' as const, error: 'Restructure loan not found.' };
    }
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }

    const now = new Date();
    const pipelineStatus =
      input.action === 'REQUEST_ADVERSE'
        ? ProcessingPipelineStatus.ADVERSE_PENDING
        : ProcessingPipelineStatus.PENDING_APPROVAL;
    const actionLabel =
      input.action === 'REQUEST_ADVERSE'
        ? 'Requested to Adverse'
        : 'Sent to Underwriting';
    const restructureNotes = appendRestructureNote(
      current.restructureNotes,
      actor,
      actionLabel,
      notes,
      now,
    );
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        pipelineStatus,
        statusChangedAt: now,
        restructureNotes,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { kind: 'conflict' as const, version: current.version };
    }

    await tx.auditLog.create({
      data: {
        loanId: current.loanId,
        userId: actor.id,
        action: `PROCESSING_RESTRUCTURE_${input.action}`,
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          previousStatus: current.pipelineStatus,
          newStatus: pipelineStatus,
          notes,
          actorName: actor.name,
        }),
      },
    });

    return {
      kind: 'ok' as const,
      version: input.version + 1,
      patch: {
        pipelineStatus,
        statusChangedAt: now.toISOString(),
        restructureNotes,
      },
    };
  });

  if (result.kind === 'error') return { success: false as const, error: result.error };
  if (result.kind === 'conflict') {
    return {
      success: false as const,
      conflict: true as const,
      version: result.version,
      error: 'This row changed in another session. Refreshing the latest values.',
    };
  }
  return {
    success: true as const,
    version: result.version,
    patch: result.patch,
  };
}

export async function moveProcessingPipelineLoan(input: {
  id: string;
  sheet: ProcessingPipelineSheet;
  fundedAt?: string | null;
  notes?: string | null;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit && actor.role !== UserRole.LOAN_OFFICER) {
    return { success: false as const, error: 'This pipeline is read-only.' };
  }
  if (!Object.values(ProcessingPipelineSheet).includes(input.sheet)) {
    return { success: false as const, error: 'Invalid destination.' };
  }
  const restructureNotes = input.notes?.trim() || '';
  if (input.sheet === ProcessingPipelineSheet.RESTRUCTURE && !restructureNotes) {
    return { success: false as const, error: 'A reason is required to move this loan to Restructures.' };
  }

  let fundedAt: Date | null = null;
  if (input.sheet === ProcessingPipelineSheet.FUNDING) {
    fundedAt = input.fundedAt ? new Date(input.fundedAt) : null;
    if (!fundedAt || Number.isNaN(fundedAt.getTime())) {
      return { success: false as const, error: 'A funded/signing date is required.' };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, editableScopeWhere(actor)] },
    });
    if (!current) return { kind: 'error' as const, error: 'Pipeline row not found.' };
    if (current.sheet === ProcessingPipelineSheet.FUNDING) {
      return { kind: 'error' as const, error: 'Funded loans are read-only.' };
    }
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }
    if (
      actor.role === UserRole.LOAN_OFFICER &&
      current.sheet === ProcessingPipelineSheet.RESTRUCTURE &&
      input.sheet !== ProcessingPipelineSheet.RESTRUCTURE
    ) {
      return {
        kind: 'error' as const,
        error: 'Only Processors, Managers, and Admins can return a restructured loan.',
      };
    }
    const now = new Date();
    const movingToRestructure = input.sheet === ProcessingPipelineSheet.RESTRUCTURE;
    const movingToFunding = input.sheet === ProcessingPipelineSheet.FUNDING;
    const returningToPipeline =
      current.sheet === ProcessingPipelineSheet.RESTRUCTURE &&
      input.sheet === ProcessingPipelineSheet.PIPELINE;
    const nextRestructureNotes = movingToRestructure
      ? appendRestructureNote(
          current.restructureNotes,
          actor,
          'Moved to Restructures',
          restructureNotes,
          now,
        )
      : current.restructureNotes;
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        sheet: input.sheet,
        movedAt: now,
        ...(movingToRestructure || returningToPipeline || movingToFunding
          ? {
              pipelineStatus: movingToFunding
                ? ProcessingPipelineStatus.FUNDED
                : movingToRestructure
                  ? ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE
                  : ProcessingPipelineStatus.RE_SUB,
              statusChangedAt: now,
            }
          : {}),
        ...(movingToFunding
          ? {
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            }
          : {}),
        ...(movingToRestructure ? { restructureNotes: nextRestructureNotes } : {}),
        version: { increment: 1 },
        ...(input.sheet === ProcessingPipelineSheet.FUNDING && fundedAt
          ? {
              fundedAt,
              firstPaymentAt: getMortgageFirstPaymentDate(fundedAt),
              sixthPaymentAt: addMonthsClamped(fundedAt, 6),
            }
          : {}),
      },
    });
    if (updated.count !== 1) return { kind: 'conflict' as const, version: current.version };
    await tx.auditLog.create({
      data: {
        loanId: current.loanId,
        userId: actor.id,
        action: 'PROCESSING_PIPELINE_MOVED',
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          fromSheet: current.sheet,
          toSheet: input.sheet,
          fundedAt: fundedAt?.toISOString() || null,
          notes: restructureNotes || null,
          actorName: actor.name,
        }),
      },
    });
    return {
      kind: 'ok' as const,
      version: input.version + 1,
      pipelineStatus: movingToRestructure
        ? ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE
        : movingToFunding
          ? ProcessingPipelineStatus.FUNDED
        : returningToPipeline
          ? ProcessingPipelineStatus.RE_SUB
          : current.pipelineStatus,
      restructureNotes: nextRestructureNotes,
    };
  });

  if (result.kind === 'error') return { success: false as const, error: result.error };
  if (result.kind === 'conflict') {
    return {
      success: false as const,
      conflict: true as const,
      version: result.version,
      error: 'This row changed in another session. Refreshing the latest values.',
    };
  }
  return {
    success: true as const,
    version: result.version,
    patch: {
      pipelineStatus: result.pipelineStatus,
      restructureNotes: result.restructureNotes,
    },
  };
}

export async function getProcessingPipelineHistory(id: string) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };
  const row = await prisma.processingPipelineLoan.findFirst({
    where: { AND: [{ id }, scopeWhere(actor)] },
    select: { loanId: true },
  });
  if (!row) return { success: false as const, error: 'Pipeline row not found.' };
  const audit = await prisma.auditLog.findMany({
    where: {
      loanId: row.loanId,
      action: { startsWith: 'PROCESSING_PIPELINE_' },
    },
    include: { user: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return {
    success: true as const,
    entries: audit.map((entry) => ({
      id: entry.id,
      action: entry.action,
      details: entry.details,
      createdAt: entry.createdAt.toISOString(),
      actor: entry.user.name,
      actorRole: entry.user.role,
    })),
  };
}
