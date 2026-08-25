'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  LeadStatus,
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
import {
  readSubmissionNotes,
  readSubmissionString,
  safeSubmissionObject,
  sanitizeProcessingSubmissionData,
  splitBorrowerName,
} from '@/lib/processingBorrowerDetails';
import { syncLeadStatusForLoan } from '@/lib/leadPipelineSync';

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
      return {
        archivedAt: null,
        OR: [
          { juniorProcessorId: actor.id },
          ...(actor.processingAssignmentGroups.length > 0
            ? [
                {
                  juniorProcessorId: null,
                  assignmentGroup: {
                    in: actor.processingAssignmentGroups,
                  },
                },
              ]
            : []),
        ],
      };
    }
    return { seniorProcessorId: actor.id, archivedAt: null };
  }
  if (access.scope === 'OWN_LOANS') {
    return {
      archivedAt: null,
      loan: {
        OR: [
          { secondaryLoanOfficerId: actor.id },
          {
            AND: [
              { secondaryLoanOfficerId: null },
              { loanOfficerId: actor.id },
            ],
          },
          { visibilitySubmitterUserId: actor.id },
        ],
      },
    };
  }
  return { id: '__NO_ACCESS__' };
}

function effectiveLoanOfficerWhere(userIds: string[]): Prisma.LoanWhereInput {
  return {
    OR: [
      { secondaryLoanOfficerId: { in: userIds } },
      {
        AND: [
          { secondaryLoanOfficerId: null },
          { loanOfficerId: { in: userIds } },
        ],
      },
    ],
  };
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
    borrowerFirstName: string | null;
    borrowerLastName: string | null;
    amount: Prisma.Decimal;
    loanOfficer: { id: string; name: string };
    secondaryLoanOfficer: { id: string; name: string } | null;
    payrollCompRequests: Array<{
      status: PayrollCompRequestStatus;
      expectedRevenue: Prisma.Decimal;
    }>;
  };
  seniorProcessor: { id: string; name: string } | null;
  juniorProcessor: { id: string; name: string } | null;
}) {
  const fallbackBorrowerName = splitBorrowerName(row.loan.borrowerName);
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
      borrowerFirstName:
        row.loan.borrowerFirstName || fallbackBorrowerName.firstName,
      borrowerLastName:
        row.loan.borrowerLastName || fallbackBorrowerName.lastName,
      loanOfficer: row.loan.secondaryLoanOfficer || row.loan.loanOfficer,
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
    clauses.push({ loan: effectiveLoanOfficerWhere(filters.loanOfficerIds) });
  }
  if (filters.teamLoanOfficerIds?.length) {
    clauses.push({ loan: effectiveLoanOfficerWhere(filters.teamLoanOfficerIds) });
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
  allSheets?: boolean;
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
  const allSheets = input?.allSheets === true && Boolean(input?.search?.trim());
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
      allSheets
        ? {}
        : rateLockRequestsOnly
          ? { rateLockRequestedAt: { not: null } }
          : { sheet: input?.sheet || ProcessingPipelineSheet.PIPELINE },
      ...(search
        ? [{
            OR: [
              { loan: { loanNumber: { contains: search, mode: 'insensitive' as const } } },
              { loan: { borrowerName: { contains: search, mode: 'insensitive' as const } } },
              {
                loan: {
                  OR: [
                    {
                      secondaryLoanOfficer: {
                        name: { contains: search, mode: 'insensitive' as const },
                      },
                    },
                    {
                      AND: [
                        { secondaryLoanOfficerId: null },
                        {
                          loanOfficer: {
                            name: { contains: search, mode: 'insensitive' as const },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
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

  const [rows, total, teams, juniorProcessors] = await prisma.$transaction([
    prisma.processingPipelineLoan.findMany({
      where,
      include: {
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            borrowerFirstName: true,
            borrowerLastName: true,
            amount: true,
            loanOfficer: { select: { id: true, name: true } },
            secondaryLoanOfficer: { select: { id: true, name: true } },
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
    prisma.user.findMany({
      where: {
        active: true,
        OR: [
          { role: UserRole.PROCESSOR_JR },
          { roles: { has: UserRole.PROCESSOR_JR } },
        ],
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
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
    juniorProcessorOptions:
      actor.role === UserRole.MANAGER || isAdmin(actor.role)
        ? juniorProcessors
        : [],
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
          secondaryLoanOfficer: { select: { id: true, name: true } },
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
      loanOfficers: uniqueUserOptions(
        rows.map((row) => row.loan.secondaryLoanOfficer || row.loan.loanOfficer),
      ),
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

export async function reassignProcessingPipelineJuniorProcessor(input: {
  id: string;
  version: number;
  juniorProcessorId: string | null;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  if (actor.role !== UserRole.MANAGER && !isAdmin(actor.role)) {
    return {
      success: false as const,
      error: 'Only Managers and Admins can reassign Jr Processors.',
    };
  }

  const juniorProcessorId = input.juniorProcessorId?.trim() || null;
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.processingPipelineLoan.findFirst({
      where: { AND: [{ id: input.id }, scopeWhere(actor)] },
      select: {
        id: true,
        loanId: true,
        sheet: true,
        version: true,
        juniorProcessorId: true,
        juniorProcessor: { select: { id: true, name: true } },
      },
    });
    if (!current) {
      return { kind: 'error' as const, error: 'Pipeline row not found.' };
    }
    if (current.sheet === ProcessingPipelineSheet.FUNDING) {
      return { kind: 'error' as const, error: 'Funded loans are read-only.' };
    }
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }

    const nextJuniorProcessor = juniorProcessorId
      ? await tx.user.findFirst({
          where: {
            id: juniorProcessorId,
            active: true,
            OR: [
              { role: UserRole.PROCESSOR_JR },
              { roles: { has: UserRole.PROCESSOR_JR } },
            ],
          },
          select: { id: true, name: true },
        })
      : null;
    if (juniorProcessorId && !nextJuniorProcessor) {
      return {
        kind: 'error' as const,
        error: 'Select an active Jr Processor.',
      };
    }
    if (current.juniorProcessorId === juniorProcessorId) {
      return {
        kind: 'ok' as const,
        version: current.version,
        juniorProcessor: current.juniorProcessor,
      };
    }

    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        juniorProcessorId,
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
        action: 'PROCESSING_PIPELINE_JR_PROCESSOR_REASSIGNED',
        details: JSON.stringify({
          processingPipelineLoanId: current.id,
          previousJuniorProcessorId: current.juniorProcessor?.id || null,
          previousJuniorProcessorName: current.juniorProcessor?.name || null,
          newJuniorProcessorId: nextJuniorProcessor?.id || null,
          newJuniorProcessorName: nextJuniorProcessor?.name || null,
          actorName: actor.name,
        }),
      },
    });
    return {
      kind: 'ok' as const,
      version: input.version + 1,
      juniorProcessor: nextJuniorProcessor,
    };
  });

  if (result.kind === 'error') {
    return { success: false as const, error: result.error };
  }
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
    patch: { juniorProcessor: result.juniorProcessor },
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
      if (input.field === 'pipelineStatus') {
        await syncLeadStatusForLoan(tx, {
          loanId: current.loanId,
          taskId: current.sourceTaskId,
          nextStatus: LeadStatus.SUBMITTED_PROCESSING,
          actorId: actor.id,
          source: 'processing-pipeline-status-changed',
        });
      }
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

    await syncLeadStatusForLoan(tx, {
      loanId: current.loanId,
      taskId: current.sourceTaskId,
      nextStatus: LeadStatus.SUBMITTED_PROCESSING,
      actorId: actor.id,
      source: `processing-restructure-${input.action.toLowerCase()}`,
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
    await syncLeadStatusForLoan(tx, {
      loanId: current.loanId,
      taskId: current.sourceTaskId,
      nextStatus: LeadStatus.SUBMITTED_PROCESSING,
      actorId: actor.id,
      source: 'processing-pipeline-moved',
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

export type ProcessingBorrowerDetailsInput = {
  id: string;
  version: number;
  borrowerFirstName: string;
  borrowerLastName: string;
  borrowerPhone: string;
  borrowerEmail: string;
  coBorrowerFirstName: string;
  coBorrowerLastName: string;
  coBorrowerPhone: string;
  coBorrowerEmail: string;
  propertyStreet: string;
  propertyUnit: string;
  propertyCity: string;
  propertyState: string;
  propertyZip: string;
  propertyOccupancy: string;
  estimatedValue: string;
  yearBuilt: string;
  yearAcquired: string;
  titleHeldAs: string;
  loanAmount: string;
  loanType: string;
  loanProgram: string;
  lender: string;
  channel: string;
  loanPurpose: string;
  leadSource: string;
  cashBack: string;
  projectedRevenue: string;
  appraisalNeeded: boolean | null;
  appraisalWaiver: string;
  appraisalOrderedAt: string;
  appraisalBackAt: string;
  appraisalNotes: string;
  sheet: ProcessingPipelineSheet;
  pipelineStatus: ProcessingPipelineStatus;
  dateAssigned: string;
  estimatedSigningAt: string;
  titleStatus: ProcessingItemStatus;
  payoffStatus: ProcessingItemStatus;
  hoiStatus: ProcessingItemStatus;
  missingItemsCurrentStatus: string;
  extraNotes: string;
  restructureNotes: string;
  rateLock: boolean;
  rateLockExpiresAt: string;
  cdSent: boolean;
  fundedAt: string;
};

function canEditProcessingBorrowerWorkspace(role: UserRole) {
  return (
    role === UserRole.PROCESSOR_JR ||
    role === UserRole.PROCESSOR_SR ||
    role === UserRole.MANAGER ||
    isAdmin(role)
  );
}

function borrowerDetailText(value: unknown, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function borrowerDetailDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function updateProcessingBorrowerDetails(
  input: ProcessingBorrowerDetailsInput,
) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView || !canEditProcessingBorrowerWorkspace(actor.role)) {
    return { success: false as const, error: 'Not authorized.' };
  }

  const firstName = borrowerDetailText(input.borrowerFirstName, 100);
  const lastName = borrowerDetailText(input.borrowerLastName, 100);
  if (!firstName && !lastName) {
    return {
      success: false as const,
      error: 'At least one primary borrower name is required.',
    };
  }
  const borrowerEmail = borrowerDetailText(input.borrowerEmail, 254).toLowerCase();
  const coBorrowerEmail = borrowerDetailText(
    input.coBorrowerEmail,
    254,
  ).toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (
    (borrowerEmail && !validEmail.test(borrowerEmail)) ||
    (coBorrowerEmail && !validEmail.test(coBorrowerEmail))
  ) {
    return { success: false as const, error: 'Enter a valid borrower email address.' };
  }
  const propertyState = borrowerDetailText(input.propertyState, 2).toUpperCase();
  if (propertyState && !/^[A-Z]{2}$/.test(propertyState)) {
    return { success: false as const, error: 'Property state must use a two-letter code.' };
  }
  const loanAmount = Number(input.loanAmount);
  const projectedRevenue = input.projectedRevenue
    ? Number(input.projectedRevenue)
    : null;
  if (!Number.isFinite(loanAmount) || loanAmount < 0) {
    return { success: false as const, error: 'Loan amount must be a valid positive amount.' };
  }
  if (
    projectedRevenue !== null &&
    (!Number.isFinite(projectedRevenue) || projectedRevenue < 0)
  ) {
    return { success: false as const, error: 'Projected revenue must be a valid positive amount.' };
  }
  const appraisalOrderedAt = borrowerDetailDate(input.appraisalOrderedAt);
  const appraisalBackAt = borrowerDetailDate(input.appraisalBackAt);
  if (appraisalOrderedAt === undefined || appraisalBackAt === undefined) {
    return { success: false as const, error: 'Enter valid appraisal dates.' };
  }
  if (
    !Object.values(ProcessingPipelineSheet).includes(input.sheet) ||
    !Object.values(ProcessingPipelineStatus).includes(input.pipelineStatus) ||
    !Object.values(ProcessingItemStatus).includes(input.titleStatus) ||
    !Object.values(ProcessingItemStatus).includes(input.payoffStatus) ||
    !Object.values(ProcessingItemStatus).includes(input.hoiStatus)
  ) {
    return { success: false as const, error: 'One or more processing values are invalid.' };
  }
  const dateAssigned = borrowerDetailDate(input.dateAssigned);
  const estimatedSigningAt = borrowerDetailDate(input.estimatedSigningAt);
  const rateLockExpiresAt = borrowerDetailDate(input.rateLockExpiresAt);
  const fundedAt = borrowerDetailDate(input.fundedAt);
  if (
    !dateAssigned ||
    estimatedSigningAt === undefined ||
    rateLockExpiresAt === undefined ||
    fundedAt === undefined
  ) {
    return { success: false as const, error: 'Enter valid processing dates.' };
  }
  const restructureStatuses = new Set<ProcessingPipelineStatus>([
    ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE,
    ProcessingPipelineStatus.ADVERSE_PENDING,
    ProcessingPipelineStatus.PENDING_APPROVAL,
  ]);
  if (
    input.sheet === ProcessingPipelineSheet.RESTRUCTURE &&
    !restructureStatuses.has(input.pipelineStatus)
  ) {
    return {
      success: false as const,
      error: 'Restructures must use Suspended/Restructure, Adverse Pending, or Pending Approval.',
    };
  }
  if (
    input.sheet === ProcessingPipelineSheet.PIPELINE &&
    (restructureStatuses.has(input.pipelineStatus) ||
      input.pipelineStatus === ProcessingPipelineStatus.FUNDED)
  ) {
    return { success: false as const, error: 'Select a status valid for the Pipeline sheet.' };
  }
  if (
    input.pipelineStatus === ProcessingPipelineStatus.DOCS_OUT &&
    !estimatedSigningAt
  ) {
    return { success: false as const, error: 'Estimated signing is required for Docs Out.' };
  }
  if (input.sheet === ProcessingPipelineSheet.FUNDING && !fundedAt) {
    return { success: false as const, error: 'A funded date is required for Fundings.' };
  }
  if (
    input.sheet === ProcessingPipelineSheet.RESTRUCTURE &&
    !borrowerDetailText(input.restructureNotes, 4000)
  ) {
    return { success: false as const, error: 'Restructure notes are required.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.processingPipelineLoan.findFirst({
        where: { AND: [{ id: input.id }, scopeWhere(actor)] },
        include: {
          loan: true,
          sourceTask: { select: { submissionData: true } },
        },
      });
      if (!current) return { kind: 'missing' as const };
      if (
        !canEditProcessingBorrowerWorkspace(actor.role) ||
        current.sheet === ProcessingPipelineSheet.FUNDING
      ) {
        return { kind: 'forbidden' as const };
      }
      if (current.version !== input.version) {
        return { kind: 'conflict' as const };
      }

      const submission = safeSubmissionObject(
        sanitizeProcessingSubmissionData(current.sourceTask.submissionData),
      );
      const submissionPatch = {
        borrowerFirstName: firstName,
        borrowerLastName: lastName,
        borrowerPhone: borrowerDetailText(input.borrowerPhone, 50),
        borrowerEmail,
        coBorrowerFirstName: borrowerDetailText(input.coBorrowerFirstName, 100),
        coBorrowerLastName: borrowerDetailText(input.coBorrowerLastName, 100),
        coBorrowerPhone: borrowerDetailText(input.coBorrowerPhone, 50),
        coBorrowerEmail,
        propertyStreet: borrowerDetailText(input.propertyStreet, 200),
        propertyUnit: borrowerDetailText(input.propertyUnit, 50),
        propertyCity: borrowerDetailText(input.propertyCity, 100),
        propertyState,
        propertyZip: borrowerDetailText(input.propertyZip, 10),
        propertyOccupancy: borrowerDetailText(input.propertyOccupancy, 100),
        homeValue: borrowerDetailText(input.estimatedValue, 30),
        yearBuiltProperty: borrowerDetailText(input.yearBuilt, 4),
        yearAquired: borrowerDetailText(input.yearAcquired, 4),
        mannerInWhichTitleWillBeHeld: borrowerDetailText(input.titleHeldAs, 200),
        loanAmount: String(loanAmount),
        loanType: borrowerDetailText(input.loanType, 100),
        loanProgram: borrowerDetailText(input.loanProgram, 200),
        lender: borrowerDetailText(input.lender, 200),
        channel: borrowerDetailText(input.channel, 100),
        loanPurpose: borrowerDetailText(input.loanPurpose, 100),
        leadSource: borrowerDetailText(input.leadSource, 200),
        cashBack: borrowerDetailText(input.cashBack, 30),
        projectedRevenue:
          projectedRevenue === null ? '' : String(projectedRevenue),
        appraisalNeeded: input.appraisalNeeded,
        appraisalWaiver: borrowerDetailText(input.appraisalWaiver, 100),
        appraisalNotes: borrowerDetailText(input.appraisalNotes, 2000),
      };
      const propertyAddress = [
        [
          submissionPatch.propertyStreet,
          submissionPatch.propertyUnit,
        ].filter(Boolean).join(' '),
        submissionPatch.propertyCity,
        [propertyState, submissionPatch.propertyZip].filter(Boolean).join(' '),
      ].filter(Boolean).join(', ') || null;

      const nextLender = submissionPatch.lender || null;
      const lockedDefaults = getProcessingPipelineLockedDefaults(
        nextLender,
        current.processingMethod,
      );
      const now = new Date();
      const nextStatus =
        input.sheet === ProcessingPipelineSheet.FUNDING
          ? ProcessingPipelineStatus.FUNDED
          : input.pipelineStatus;
      const statusChanged =
        current.pipelineStatus !== nextStatus || current.sheet !== input.sheet;
      const lockedAppraisal = isProcessingPipelineFieldLocked(
        'appraisalNeeded',
        nextLender,
        current.processingMethod,
      );
      const lockedTitle = isProcessingPipelineFieldLocked(
        'titleStatus',
        nextLender,
        current.processingMethod,
      );
      const lockedPayoff = isProcessingPipelineFieldLocked(
        'payoffStatus',
        nextLender,
        current.processingMethod,
      );
      const lockedHoi = isProcessingPipelineFieldLocked(
        'hoiStatus',
        nextLender,
        current.processingMethod,
      );
      const lockedCdSent = isProcessingPipelineFieldLocked(
        'cdSent',
        nextLender,
        current.processingMethod,
      );
      const lockedRateLock = isProcessingPipelineFieldLocked(
        'rateLock',
        nextLender,
        current.processingMethod,
      );
      if (input.rateLock && !rateLockExpiresAt && !lockedRateLock) {
        return {
          kind: 'validation' as const,
          error: 'A Rate Lock expiration date is required when Rate Lock is Yes.',
        };
      }
      const nextRateLock = lockedRateLock ? current.rateLock : input.rateLock;
      const nextRateLockConfirmedAt = nextRateLock
        ? current.rateLockConfirmedAt ?? now
        : null;
      const nextCdSent = lockedCdSent ? current.cdSent : input.cdSent;
      const pipelineData: Prisma.ProcessingPipelineLoanUpdateManyMutationInput = {
        version: { increment: 1 },
        sheet: input.sheet,
        movedAt: current.sheet === input.sheet ? current.movedAt : now,
        pipelineStatus: nextStatus,
        statusChangedAt: statusChanged ? now : current.statusChangedAt,
        dateAssigned,
        estimatedSigningAt:
          nextStatus === ProcessingPipelineStatus.DOCS_OUT
            ? estimatedSigningAt
            : estimatedSigningAt || null,
        approvedWithConditionsAt: getApprovedWithConditionsAt(
          nextStatus,
          current.approvedWithConditionsAt,
          now,
        ),
        propertyState: propertyState || null,
        loanType: submissionPatch.loanType || null,
        lender: nextLender,
        leadSource: submissionPatch.leadSource || null,
        projectedRevenue,
        titleStatus: lockedTitle ? current.titleStatus : input.titleStatus,
        payoffStatus: lockedPayoff ? current.payoffStatus : input.payoffStatus,
        payoffOrderedAt: lockedPayoff
          ? current.payoffOrderedAt
          : getItemOrderedAt(
              input.payoffStatus,
              current.payoffOrderedAt,
              now,
            ),
        hoiStatus: lockedHoi ? current.hoiStatus : input.hoiStatus,
        hoiOrderedAt: lockedHoi
          ? current.hoiOrderedAt
          : getItemOrderedAt(input.hoiStatus, current.hoiOrderedAt, now),
        missingItemsCurrentStatus:
          borrowerDetailText(input.missingItemsCurrentStatus, 2000) || null,
        extraNotes: borrowerDetailText(input.extraNotes, 4000) || null,
        restructureNotes:
          borrowerDetailText(input.restructureNotes, 4000) || null,
        rateLock: nextRateLock,
        rateLockExpiresAt: lockedRateLock
          ? current.rateLockExpiresAt
          : nextRateLock
            ? rateLockExpiresAt
            : null,
        rateLockConfirmedAt: nextRateLockConfirmedAt,
        cdSent: nextCdSent,
        cdWarningStartsAt: nextCdSent
          ? null
          : getCdWarningStartsAt(
              nextRateLock,
              current.cdWarningStartsAt,
              now,
            ),
        appraisalNeeded: lockedAppraisal
          ? current.appraisalNeeded
          : input.appraisalNeeded,
        appraisalNotes: submissionPatch.appraisalNotes || null,
        appraisalOrderedAt,
        appraisalBackAt,
        ...(nextRateLock
          ? {
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            }
          : {}),
        ...(input.sheet === ProcessingPipelineSheet.FUNDING && fundedAt
          ? {
              fundedAt,
              firstPaymentAt: getMortgageFirstPaymentDate(fundedAt),
              sixthPaymentAt: addMonthsClamped(fundedAt, 6),
              rateLockRequestedAt: null,
              rateLockRequestedById: null,
            }
          : input.sheet !== ProcessingPipelineSheet.FUNDING
            ? {
                fundedAt: null,
                firstPaymentAt: null,
                sixthPaymentAt: null,
              }
            : {}),
      };
      if (lockedDefaults) {
        submissionPatch.appraisalNeeded =
          lockedDefaults.values.appraisalNeeded ?? submissionPatch.appraisalNeeded;
        Object.assign(pipelineData, lockedDefaults.values, {
          payoffOrderedAt: null,
          hoiOrderedAt: null,
        });
        if (lockedDefaults.kind === 'SPECIAL_LENDER') {
          Object.assign(pipelineData, {
            cdWarningStartsAt: null,
            rateLockExpiresAt: null,
            rateLockConfirmedAt: current.rateLockConfirmedAt ?? new Date(),
            rateLockRequestedAt: null,
            rateLockRequestedById: null,
          });
        }
      }
      const updated = await tx.processingPipelineLoan.updateMany({
        where: { id: current.id, version: current.version },
        data: pipelineData,
      });
      if (updated.count !== 1) return { kind: 'conflict' as const };

      await tx.loan.update({
        where: { id: current.loanId },
        data: {
          borrowerName: [firstName, lastName].filter(Boolean).join(' '),
          borrowerFirstName: firstName || null,
          borrowerLastName: lastName || null,
          borrowerPhone: submissionPatch.borrowerPhone || null,
          borrowerEmail: borrowerEmail || null,
          amount: loanAmount,
          program: submissionPatch.loanProgram || null,
          propertyAddress,
        },
      });
      await tx.task.update({
        where: { id: current.sourceTaskId },
        data: {
          submissionData: {
            ...submission,
            ...submissionPatch,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.auditLog.create({
        data: {
          loanId: current.loanId,
          userId: actor.id,
          action: 'PROCESSING_BORROWER_DETAILS_UPDATED',
          details: JSON.stringify({
            source: 'borrower_workspace',
            fields: [
              ...Object.keys(submissionPatch),
              'sheet',
              'pipelineStatus',
              'dateAssigned',
              'estimatedSigningAt',
              'titleStatus',
              'payoffStatus',
              'hoiStatus',
              'missingItemsCurrentStatus',
              'extraNotes',
              'restructureNotes',
              'rateLock',
              'rateLockExpiresAt',
              'cdSent',
              'fundedAt',
              'appraisalOrderedAt',
              'appraisalBackAt',
            ],
          }),
        },
      });
      await syncLeadStatusForLoan(tx, {
        loanId: current.loanId,
        taskId: current.sourceTaskId,
        nextStatus: LeadStatus.SUBMITTED_PROCESSING,
        actorId: actor.id,
        source: 'processing-borrower-details-updated',
      });
      return { kind: 'ok' as const };
    });

    if (result.kind === 'missing') {
      return { success: false as const, error: 'Pipeline row not found.' };
    }
    if (result.kind === 'forbidden') {
      return {
        success: false as const,
        error: 'You do not have permission to edit this file.',
      };
    }
    if (result.kind === 'validation') {
      return { success: false as const, error: result.error };
    }
    if (result.kind === 'conflict') {
      return {
        success: false as const,
        conflict: true as const,
        error: 'This file changed while you were editing it. Reload and try again.',
      };
    }
    return { success: true as const };
  } catch (error) {
    console.error('Failed to update processing borrower details:', error);
    return { success: false as const, error: 'Unable to save borrower details.' };
  }
}

export async function getProcessingBorrowerDetails(id: string) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };

  const row = await prisma.processingPipelineLoan.findFirst({
    where: { AND: [{ id }, scopeWhere(actor)] },
    include: {
      loan: {
        include: {
          loanOfficer: { select: { id: true, name: true, email: true } },
          secondaryLoanOfficer: {
            select: { id: true, name: true, email: true },
          },
        },
      },
      seniorProcessor: { select: { id: true, name: true, email: true } },
      juniorProcessor: { select: { id: true, name: true, email: true } },
      sourceTask: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          completedAt: true,
          submissionData: true,
          attachments: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              filename: true,
              contentType: true,
              sizeBytes: true,
              purpose: true,
              createdAt: true,
              uploadedBy: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return { success: false as const, error: 'Pipeline row not found.' };

  const submission = safeSubmissionObject(row.sourceTask.submissionData);
  const effectiveLoanOfficer =
    row.loan.secondaryLoanOfficer || row.loan.loanOfficer;
  const propertyAddress =
    row.loan.propertyAddress ||
    readSubmissionString(
      submission,
      'propertyAddress',
      'subjectPropertyAddress',
    ) ||
    [
      [
        readSubmissionString(submission, 'propertyStreet'),
        readSubmissionString(submission, 'propertyUnit'),
      ].filter(Boolean).join(' '),
      readSubmissionString(submission, 'propertyCity'),
      [
        readSubmissionString(submission, 'propertyState'),
        readSubmissionString(submission, 'propertyZip'),
      ].filter(Boolean).join(' '),
    ].filter(Boolean).join(', ') ||
    null;

  const audit = await prisma.auditLog.findMany({
    where: {
      loanId: row.loanId,
      action: { startsWith: 'PROCESSING_' },
    },
    include: { user: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return {
    success: true as const,
    details: {
      id: row.id,
      version: row.version,
      canEdit:
        row.sheet !== ProcessingPipelineSheet.FUNDING &&
        canEditProcessingBorrowerWorkspace(actor.role),
      borrower: {
        name: row.loan.borrowerName,
        firstName:
          row.loan.borrowerFirstName ||
          readSubmissionString(submission, 'borrowerFirstName'),
        lastName:
          row.loan.borrowerLastName ||
          readSubmissionString(submission, 'borrowerLastName'),
        phone:
          row.loan.borrowerPhone ||
          readSubmissionString(submission, 'borrowerPhone'),
        email:
          row.loan.borrowerEmail ||
          readSubmissionString(submission, 'borrowerEmail'),
        coBorrower: {
          firstName: readSubmissionString(submission, 'coBorrowerFirstName'),
          lastName: readSubmissionString(submission, 'coBorrowerLastName'),
          phone: readSubmissionString(submission, 'coBorrowerPhone'),
          email: readSubmissionString(submission, 'coBorrowerEmail'),
        },
      },
      property: {
        address: propertyAddress,
        street: readSubmissionString(submission, 'propertyStreet'),
        unit: readSubmissionString(submission, 'propertyUnit'),
        city: readSubmissionString(submission, 'propertyCity'),
        state:
          row.propertyState ||
          readSubmissionString(submission, 'propertyState'),
        zip: readSubmissionString(submission, 'propertyZip'),
        occupancy: readSubmissionString(
          submission,
          'propertyOccupancy',
          'occupancyType',
        ),
        estimatedValue: readSubmissionString(
          submission,
          'homeValue',
          'estimatedValue',
        ),
        yearBuilt: readSubmissionString(
          submission,
          'yearBuiltProperty',
          'yearBuilt',
        ),
        yearAcquired: readSubmissionString(
          submission,
          'yearAquired',
          'yearAcquired',
        ),
        titleHeldAs: readSubmissionString(
          submission,
          'mannerInWhichTitleWillBeHeld',
        ),
      },
      loan: {
        id: row.loan.id,
        loanNumber: row.loan.loanNumber,
        amount: Number(row.loan.amount),
        program:
          row.loan.program ||
          readSubmissionString(submission, 'loanProgram'),
        loanType:
          row.loanType || readSubmissionString(submission, 'loanType'),
        lender: row.lender,
        channel: readSubmissionString(submission, 'channel'),
        purpose: readSubmissionString(submission, 'loanPurpose', 'loanProgram'),
        leadSource: row.leadSource,
        cashBack: readSubmissionString(submission, 'cashBack'),
        projectedRevenue:
          row.projectedRevenue === null ? null : Number(row.projectedRevenue),
      },
      ownership: {
        loanOfficer: effectiveLoanOfficer,
        primaryLoanOfficer: row.loan.loanOfficer,
        secondaryLoanOfficer: row.loan.secondaryLoanOfficer,
        juniorProcessor: row.juniorProcessor,
        seniorProcessor: row.seniorProcessor,
        assignmentGroup: row.assignmentGroup,
        processingMethod: row.processingMethod,
      },
      processing: {
        sheet: row.sheet,
        pipelineStatus: row.pipelineStatus,
        daysInStatus: calculateDaysInStatus(row.statusChangedAt),
        statusChangedAt: row.statusChangedAt.toISOString(),
        dateAssigned: row.dateAssigned.toISOString(),
        estimatedSigningAt: row.estimatedSigningAt?.toISOString() || null,
        titleStatus: row.titleStatus,
        payoffStatus: row.payoffStatus,
        hoiStatus: row.hoiStatus,
        missingItemsCurrentStatus: row.missingItemsCurrentStatus,
        extraNotes: row.extraNotes,
        restructureNotes: row.restructureNotes,
        rateLock: row.rateLock,
        rateLockExpiresAt: row.rateLockExpiresAt?.toISOString() || null,
        cdSent: row.cdSent,
        fundedAt: row.fundedAt?.toISOString() || null,
      },
      appraisal: {
        needed: row.appraisalNeeded,
        notes: row.appraisalNotes,
        waiver: readSubmissionString(submission, 'appraisalWaiver'),
        orderedAt: row.appraisalOrderedAt?.toISOString() || null,
        backAt: row.appraisalBackAt?.toISOString() || null,
      },
      sourceTask: {
        id: row.sourceTask.id,
        title: row.sourceTask.title,
        status: row.sourceTask.status,
        createdAt: row.sourceTask.createdAt.toISOString(),
        completedAt: row.sourceTask.completedAt?.toISOString() || null,
      },
      notes: readSubmissionNotes(submission),
      attachments: row.sourceTask.attachments.map((attachment) => ({
        ...attachment,
        createdAt: attachment.createdAt.toISOString(),
        uploadedBy: attachment.uploadedBy.name,
      })),
      activity: audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
        actor: entry.user.name,
        actorRole: entry.user.role,
      })),
      submission: sanitizeProcessingSubmissionData(submission),
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
