'use server';

import { unstable_noStore as noStore } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  Prisma,
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  addMonthsClamped,
  calculateDaysInStatus,
  getApprovedWithConditionsAt,
  getCdWarningStartsAt,
  getProcessingPipelineAccess,
  parseOptionalBoolean,
  parseOptionalMoney,
} from '@/lib/processingPipeline';

const PAGE_SIZE_MAX = 200;

type Actor = {
  id: string;
  role: UserRole;
  name: string;
};

async function getActor(): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  if (!id || !role) return null;
  return { id, role, name: session.user.name || 'Unknown user' };
}

function scopeWhere(actor: Actor): Prisma.ProcessingPipelineLoanWhereInput {
  const access = getProcessingPipelineAccess(actor.role);
  if (access.scope === 'COMPANY') return {};
  if (access.scope === 'ASSIGNED') return { seniorProcessorId: actor.id };
  if (access.scope === 'OWN_LOANS') {
    return {
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

function serializeRow(row: {
  id: string;
  version: number;
  sheet: ProcessingPipelineSheet;
  pipelineStatus: ProcessingPipelineStatus;
  statusChangedAt: Date;
  titleStatus: ProcessingItemStatus;
  payoffStatus: ProcessingItemStatus;
  hoiStatus: ProcessingItemStatus;
  dateAssigned: Date;
  appraisalNeeded: boolean | null;
  appraisalNotes: string | null;
  appraisalOrderedAt: Date | null;
  appraisalBackAt: Date | null;
  cdSent: boolean;
  cdWarningStartsAt: Date | null;
  missingItemsCurrentStatus: string | null;
  extraNotes: string | null;
  rateLock: boolean;
  rateLockExpiresAt: Date | null;
  rateLockConfirmedAt: Date | null;
  approvedWithConditionsAt: Date | null;
  loanType: string | null;
  propertyState: string | null;
  lender: string | null;
  projectedRevenue: Prisma.Decimal | null;
  finalRevenue: Prisma.Decimal | null;
  fundedAt: Date | null;
  firstPaymentAt: Date | null;
  sixthPaymentAt: Date | null;
  movedAt: Date | null;
  updatedAt: Date;
  assignmentGroup: string | null;
  loan: {
    id: string;
    loanNumber: string;
    borrowerName: string;
    amount: Prisma.Decimal;
    loanOfficer: { id: string; name: string };
  };
  seniorProcessor: { id: string; name: string } | null;
  juniorProcessor: { id: string; name: string } | null;
}) {
  return {
    ...row,
    dateAssigned: row.dateAssigned.toISOString(),
    statusChangedAt: row.statusChangedAt.toISOString(),
    appraisalOrderedAt: row.appraisalOrderedAt?.toISOString() || null,
    appraisalBackAt: row.appraisalBackAt?.toISOString() || null,
    cdWarningStartsAt: row.cdWarningStartsAt?.toISOString() || null,
    rateLockExpiresAt: row.rateLockExpiresAt?.toISOString() || null,
    rateLockConfirmedAt: row.rateLockConfirmedAt?.toISOString() || null,
    approvedWithConditionsAt: row.approvedWithConditionsAt?.toISOString() || null,
    fundedAt: row.fundedAt?.toISOString() || null,
    firstPaymentAt: row.firstPaymentAt?.toISOString() || null,
    sixthPaymentAt: row.sixthPaymentAt?.toISOString() || null,
    movedAt: row.movedAt?.toISOString() || null,
    updatedAt: row.updatedAt.toISOString(),
    projectedRevenue: row.projectedRevenue === null ? null : Number(row.projectedRevenue),
    finalRevenue: row.finalRevenue === null ? null : Number(row.finalRevenue),
    daysInStatus: calculateDaysInStatus(row.statusChangedAt),
    loan: {
      ...row.loan,
      amount: Number(row.loan.amount),
    },
  };
}

export type ProcessingPipelineRow = ReturnType<typeof serializeRow>;

export type ProcessingPipelineFilters = {
  loanOfficerIds?: string[];
  assignedFrom?: string;
  assignedTo?: string;
  loanNumbers?: string[];
  borrowerNames?: string[];
  loanAmountMin?: number;
  loanAmountMax?: number;
  loanTypes?: string[];
  states?: string[];
  lenders?: string[];
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
  rateLock?: Array<'YES' | 'NO' | 'BLANK'>;
  rateLockExpiresFrom?: string;
  rateLockExpiresTo?: string;
  fundedFrom?: string;
  fundedTo?: string;
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
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'dateAssigned' | 'statusChangedAt' | 'borrowerName' | 'loanNumber';
  sortDirection?: 'asc' | 'desc';
  filters?: ProcessingPipelineFilters;
}) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };

  const page = Math.max(1, Math.floor(input?.page || 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(10, Math.floor(input?.pageSize || 100)));
  const search = input?.search?.trim();
  const where: Prisma.ProcessingPipelineLoanWhereInput = {
    AND: [
      scopeWhere(actor),
      { sheet: input?.sheet || ProcessingPipelineSheet.PIPELINE },
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
  let orderBy: Prisma.ProcessingPipelineLoanOrderByWithRelationInput;
  if (input?.sortBy === 'borrowerName') orderBy = { loan: { borrowerName: sortDirection } };
  else if (input?.sortBy === 'loanNumber') orderBy = { loan: { loanNumber: sortDirection } };
  else if (input?.sortBy === 'statusChangedAt') orderBy = { statusChangedAt: sortDirection };
  else orderBy = { dateAssigned: sortDirection };

  const [rows, total] = await prisma.$transaction([
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
          },
        },
        seniorProcessor: { select: { id: true, name: true } },
        juniorProcessor: { select: { id: true, name: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.processingPipelineLoan.count({ where }),
  ]);

  return {
    success: true as const,
    rows: rows.map(serializeRow),
    total,
    page,
    pageSize,
    canEdit: access.canEdit,
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

export async function getProcessingPipelineFilterOptions(sheet: ProcessingPipelineSheet) {
  noStore();
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canView) return { success: false as const, error: 'Not authorized.' };

  const rows = await prisma.processingPipelineLoan.findMany({
    where: { AND: [scopeWhere(actor), { sheet }] },
    select: {
      loanType: true,
      propertyState: true,
      lender: true,
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
  'cdSent',
  'missingItemsCurrentStatus',
  'extraNotes',
  'lender',
  'finalRevenue',
] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

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
  if (field === 'appraisalOrderedAt' || field === 'appraisalBackAt') {
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
  return String(value ?? '').trim() || null;
}

export async function updateProcessingPipelineCell(input: {
  id: string;
  field: EditableField;
  value: unknown;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit) return { success: false as const, error: 'This pipeline is read-only.' };
  if (!EDITABLE_FIELDS.includes(input.field)) {
    return { success: false as const, error: 'This field cannot be edited.' };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.processingPipelineLoan.findFirst({
        where: { AND: [{ id: input.id }, scopeWhere(actor)] },
      });
      if (!current) throw new Error('Pipeline row not found.');
      if (current.version !== input.version) {
        return { conflict: true as const, version: current.version };
      }

      const nextValue = normalizeCellValue(input.field, input.value);
      const now = new Date();
      let approvedWithConditionsAt = current.approvedWithConditionsAt;
      let cdWarningStartsAt = current.cdWarningStartsAt;
      const data: Prisma.ProcessingPipelineLoanUpdateManyMutationInput = {
        [input.field]: nextValue,
        version: { increment: 1 },
      };
      if (input.field === 'pipelineStatus') {
        data.statusChangedAt = now;
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
      if (input.field === 'appraisalBackAt') {
        cdWarningStartsAt = getCdWarningStartsAt(
          nextValue instanceof Date ? nextValue : null,
          current.rateLock,
          current.rateLockExpiresAt,
          now,
        );
        data.cdWarningStartsAt = cdWarningStartsAt;
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
            actorName: actor.name,
          }),
        },
      });
      return {
        conflict: false as const,
        version: input.version + 1,
        patch: {
          approvedWithConditionsAt: approvedWithConditionsAt?.toISOString() || null,
          cdWarningStartsAt: cdWarningStartsAt?.toISOString() || null,
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
  if (!access.canEdit) return { success: false as const, error: 'This pipeline is read-only.' };

  let expiresAt: Date | null = null;
  if (input.rateLock) {
    expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (!expiresAt || Number.isNaN(expiresAt.getTime())) {
      return {
        success: false as const,
        error: 'A valid expiration date is required when Rate Lock is Yes.',
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
        where: { AND: [{ id: input.id }, scopeWhere(actor)] },
      });
      if (!current) throw new Error('Pipeline row not found.');
      if (current.version !== input.version) {
        return { conflict: true as const, version: current.version };
      }

      const now = new Date();
      const rateLockConfirmedAt = input.rateLock ? now : null;
      const cdWarningStartsAt = getCdWarningStartsAt(
        current.appraisalBackAt,
        input.rateLock,
        expiresAt,
        now,
      );
      const updated = await tx.processingPipelineLoan.updateMany({
        where: { id: current.id, version: input.version },
        data: {
          rateLock: input.rateLock,
          rateLockExpiresAt: expiresAt,
          rateLockConfirmedAt,
          cdWarningStartsAt,
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

      return {
        conflict: false as const,
        version: input.version + 1,
        patch: {
          rateLock: input.rateLock,
          rateLockExpiresAt: expiresAt?.toISOString() || null,
          rateLockConfirmedAt: rateLockConfirmedAt?.toISOString() || null,
          cdWarningStartsAt: cdWarningStartsAt?.toISOString() || null,
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

export async function moveProcessingPipelineLoan(input: {
  id: string;
  sheet: ProcessingPipelineSheet;
  fundedAt?: string | null;
  version: number;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = getProcessingPipelineAccess(actor.role);
  if (!access.canEdit) return { success: false as const, error: 'This pipeline is read-only.' };
  if (!Object.values(ProcessingPipelineSheet).includes(input.sheet)) {
    return { success: false as const, error: 'Invalid destination.' };
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
      where: { AND: [{ id: input.id }, scopeWhere(actor)] },
    });
    if (!current) return { kind: 'error' as const, error: 'Pipeline row not found.' };
    if (current.version !== input.version) {
      return { kind: 'conflict' as const, version: current.version };
    }
    const now = new Date();
    const updated = await tx.processingPipelineLoan.updateMany({
      where: { id: current.id, version: input.version },
      data: {
        sheet: input.sheet,
        movedAt: now,
        version: { increment: 1 },
        ...(input.sheet === ProcessingPipelineSheet.FUNDING && fundedAt
          ? {
              fundedAt,
              firstPaymentAt: addMonthsClamped(fundedAt, 1),
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
          actorName: actor.name,
        }),
      },
    });
    return { kind: 'ok' as const, version: input.version + 1 };
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
  return { success: true as const, version: result.version };
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
