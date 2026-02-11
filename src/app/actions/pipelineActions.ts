'use server';

import { prisma } from '@/lib/prisma';
import { LoanStage, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const DEFAULT_PIPELINE_STAGES = [
  { name: 'New Lead', color: '#60A5FA' },
  { name: 'Contacted', color: '#34D399' },
  { name: 'Processing', color: '#FBBF24' },
  { name: 'Conditional Approval', color: '#F97316' },
  { name: 'Approved', color: '#22C55E' },
  { name: 'Funded', color: '#0EA5E9' },
  { name: 'Closed / Lost', color: '#94A3B8' },
];

type CsvRow = {
  loanNumber: string;
  borrowerName?: string;
  borrowerFirstName?: string;
  borrowerLastName?: string;
  amount?: string | number;
  stage?: string;
};

async function getSessionUser() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id || null;
  const role = session?.user?.role as UserRole | undefined;
  if (!id || !role) return null;
  return { id, role };
}

function canViewAll(role?: UserRole | null) {
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
}

async function resolveLoanOfficerId(requestedId?: string | null) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;

  if (canViewAll(sessionUser.role)) {
    if (requestedId) return requestedId;
    const lo = await prisma.user.findFirst({
      where: { role: UserRole.LOAN_OFFICER, active: true },
      orderBy: { createdAt: 'asc' },
    });
    return lo?.id || null;
  }

  if (sessionUser.role === UserRole.LOAN_OFFICER) {
    return sessionUser.id;
  }

  return null;
}

async function ensureDefaultStages(loanOfficerId: string) {
  const existing = await prisma.pipelineStage.count({
    where: { userId: loanOfficerId },
  });
  if (existing > 0) return;

  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((stage, index) => ({
      userId: loanOfficerId,
      name: stage.name,
      order: index,
      color: stage.color,
      isDefault: true,
    })),
  });
}

export async function getLoanOfficers() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return [];

  if (canViewAll(sessionUser.role)) {
    return prisma.user.findMany({
      where: { role: UserRole.LOAN_OFFICER, active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });
  }

  if (sessionUser.role === UserRole.LOAN_OFFICER) {
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { id: true, name: true, email: true },
    });
    return user ? [user] : [];
  }

  return [];
}

export async function getPipelineData(loanOfficerId?: string | null) {
  const resolvedId = await resolveLoanOfficerId(loanOfficerId);
  if (!resolvedId) {
    return { loanOfficerId: null, stages: [], loans: [] };
  }

  await ensureDefaultStages(resolvedId);

  const [stages, loans] = await Promise.all([
    prisma.pipelineStage.findMany({
      where: { userId: resolvedId },
      orderBy: { order: 'asc' },
    }),
    prisma.loan.findMany({
      where: { loanOfficerId: resolvedId },
      include: { pipelineStage: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  return {
    loanOfficerId: resolvedId,
    stages,
    loans: loans.map((loan) => ({
      ...loan,
      amount: Number(loan.amount),
      createdAt: loan.createdAt,
      updatedAt: loan.updatedAt,
    })),
  };
}

export async function createPipelineStage(loanOfficerId: string, name: string, color?: string | null) {
  const resolvedId = await resolveLoanOfficerId(loanOfficerId);
  if (!resolvedId) {
    throw new Error('Not authorized to create stages for this user.');
  }

  const maxOrder = await prisma.pipelineStage.findFirst({
    where: { userId: resolvedId },
    orderBy: { order: 'desc' },
    select: { order: true },
  });

  const stage = await prisma.pipelineStage.create({
    data: {
      userId: resolvedId,
      name,
      order: (maxOrder?.order ?? -1) + 1,
      color: color || null,
    },
  });

  revalidatePath('/pipeline');
  return stage;
}

export async function updatePipelineStage(stageId: string, name: string, color?: string | null) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error('Not authenticated.');
  if (!canViewAll(sessionUser.role)) {
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: { userId: true },
    });
    if (!stage || stage.userId !== sessionUser.id) {
      throw new Error('Not authorized to update this stage.');
    }
  }

  const stage = await prisma.pipelineStage.update({
    where: { id: stageId },
    data: { name, color: color || null },
  });
  revalidatePath('/pipeline');
  return stage;
}

export async function deletePipelineStage(stageId: string, moveToStageId?: string | null) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error('Not authenticated.');
  if (!canViewAll(sessionUser.role)) {
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: stageId },
      select: { userId: true },
    });
    if (!stage || stage.userId !== sessionUser.id) {
      throw new Error('Not authorized to delete this stage.');
    }
  }

  await prisma.loan.updateMany({
    where: { pipelineStageId: stageId },
    data: { pipelineStageId: moveToStageId || null },
  });

  await prisma.pipelineStage.delete({
    where: { id: stageId },
  });

  revalidatePath('/pipeline');
  return { success: true };
}

export async function reorderPipelineStages(loanOfficerId: string, orderedStageIds: string[]) {
  const resolvedId = await resolveLoanOfficerId(loanOfficerId);
  if (!resolvedId) {
    throw new Error('Not authorized to reorder stages for this user.');
  }

  await prisma.$transaction(
    orderedStageIds.map((stageId, index) =>
      prisma.pipelineStage.update({
        where: { id: stageId, userId: resolvedId },
        data: { order: index },
      })
    )
  );

  revalidatePath('/pipeline');
  return { success: true };
}

export async function moveLoanToPipelineStage(loanId: string, pipelineStageId: string | null) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error('Not authenticated.');
  if (!canViewAll(sessionUser.role)) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { loanOfficerId: true },
    });
    if (!loan || loan.loanOfficerId !== sessionUser.id) {
      throw new Error('Not authorized to move this loan.');
    }
  }

  const loan = await prisma.loan.update({
    where: { id: loanId },
    data: { pipelineStageId },
  });

  revalidatePath('/pipeline');
  return loan;
}

export async function addPipelineNote(loanId: string, userId: string | null, body: string) {
  const sessionUser = await getSessionUser();
  let resolvedUserId = sessionUser?.id || userId;
  if (!resolvedUserId) {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      select: { loanOfficerId: true },
    });
    resolvedUserId = loan?.loanOfficerId || null;
  }

  if (!resolvedUserId) {
    return { success: false, error: 'No author available' };
  }

  const note = await prisma.pipelineNote.create({
    data: {
      loanId,
      userId: resolvedUserId,
      body,
    },
  });

  revalidatePath('/pipeline');
  return { success: true, note };
}

export async function getLoanDetails(loanId: string) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) throw new Error('Not authenticated.');

  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      pipelineStage: true,
      tasks: {
        orderBy: { createdAt: 'desc' },
      },
      pipelineNotes: {
        include: { user: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!loan) return null;
  if (!canViewAll(sessionUser.role) && loan.loanOfficerId !== sessionUser.id) {
    throw new Error('Not authorized to view this loan.');
  }

  return {
    ...loan,
    amount: Number(loan.amount),
    createdAt: loan.createdAt,
    updatedAt: loan.updatedAt,
    tasks: loan.tasks.map((task) => ({
      ...task,
      dueDate: task.dueDate,
      completedAt: task.completedAt,
    })),
  };
}

export async function importPipelineCsv(loanOfficerId: string, rows: CsvRow[]) {
  const resolvedId = await resolveLoanOfficerId(loanOfficerId);
  if (!resolvedId) {
    return { created: 0, skipped: rows.length, error: 'No loan officer found' };
  }

  await ensureDefaultStages(resolvedId);
  const stages = await prisma.pipelineStage.findMany({
    where: { userId: resolvedId },
    orderBy: { order: 'asc' },
  });

  const stageByName = new Map(
    stages.map((stage) => [stage.name.toLowerCase(), stage.id])
  );
  const defaultStageId = stages[0]?.id || null;

  const cleanedRows = rows
    .map((row) => ({
      loanNumber: String(row.loanNumber || '').trim(),
      borrowerName:
        row.borrowerName?.trim() ||
        `${row.borrowerFirstName || ''} ${row.borrowerLastName || ''}`.trim() ||
        'Unknown Borrower',
      amount: Number(String(row.amount || '0').replace(/[^0-9.-]/g, '')) || 0,
      stageName: row.stage?.trim().toLowerCase() || '',
    }))
    .filter((row) => row.loanNumber.length > 0);

  if (cleanedRows.length === 0) {
    return { created: 0, skipped: rows.length };
  }

  const uniqueLoanNumbers = Array.from(
    new Set(cleanedRows.map((row) => row.loanNumber))
  );

  const existingLoans = await prisma.loan.findMany({
    where: { loanNumber: { in: uniqueLoanNumbers } },
    select: { loanNumber: true },
  });

  const existingSet = new Set(existingLoans.map((loan) => loan.loanNumber));
  const createData = cleanedRows
    .filter((row) => !existingSet.has(row.loanNumber))
    .map((row) => ({
      loanNumber: row.loanNumber,
      borrowerName: row.borrowerName,
      amount: row.amount,
      stage: LoanStage.INTAKE,
      loanOfficerId: resolvedId,
      pipelineStageId: stageByName.get(row.stageName) || defaultStageId,
    }));

  if (createData.length > 0) {
    await prisma.loan.createMany({
      data: createData,
      skipDuplicates: true,
    });
  }

  revalidatePath('/pipeline');
  return { created: createData.length, skipped: cleanedRows.length - createData.length };
}
