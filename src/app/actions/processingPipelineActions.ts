'use server';

import { unstable_noStore as noStore, revalidatePath } from 'next/cache';
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
  missingItemsCurrentStatus: string | null;
  extraNotes: string | null;
  rateLock: boolean | null;
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

export async function getProcessingPipeline(input?: {
  sheet?: ProcessingPipelineSheet;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'dateAssigned' | 'statusChangedAt' | 'borrowerName' | 'loanNumber';
  sortDirection?: 'asc' | 'desc';
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

const EDITABLE_FIELDS = [
  'pipelineStatus',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'appraisalNeeded',
  'appraisalNotes',
  'appraisalOrderedAt',
  'appraisalBackAt',
  'missingItemsCurrentStatus',
  'extraNotes',
  'rateLock',
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
  if (field === 'appraisalNeeded' || field === 'rateLock') {
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
      const data: Prisma.ProcessingPipelineLoanUpdateManyMutationInput = {
        [input.field]: nextValue,
        version: { increment: 1 },
        ...(input.field === 'pipelineStatus' ? { statusChangedAt: now } : {}),
      };
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
      return { conflict: false as const, version: input.version + 1 };
    });

    if (result.conflict) {
      return {
        success: false as const,
        conflict: true as const,
        version: result.version,
        error: 'This row changed in another session. Refreshing the latest values.',
      };
    }
    revalidatePath('/pipeline');
    return { success: true as const, version: result.version };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Unable to save this change.',
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
  revalidatePath('/pipeline');
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
