'use server';
import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { isAdminIII } from '@/lib/adminTiers';
import { prisma } from '@/lib/prisma';
import { AriveError, ariveConfigured } from '@/lib/ariveClient';
import { assertAriveSyncPilot, syncArivePipeline } from '@/lib/arivePipelineSync';
import { ARIVE_SYNC_PILOT } from '@/lib/ariveSyncTypes';

async function context(id: string) {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  if (!session?.user?.id || !isAdminIII(role)) throw new AriveError('Only Admin III can manage the Arive sync pilot.');
  const actor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, role: true, roles: true } });
  if (!actor?.active || ![actor.role, ...actor.roles].some(isAdminIII)) throw new AriveError('Your current account cannot manage Arive sync.');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new AriveError('Choose the existing test file.');
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') throw new AriveError('Arive synchronization is disabled on preview deployments.');
  const row = await prisma.processingPipelineLoan.findUnique({ where: { id }, include: { loan: { include: { loanOfficer: { select: { email: true } } } } } });
  if (!row) throw new AriveError('Pipeline file not found.');
  assertAriveSyncPilot(row.loan);
  return { row, actor };
}
function failure(error: unknown) {
  return { success: false as const, error: error instanceof AriveError ? error.message : 'Unable to update Arive synchronization. Please retry.' };
}
export async function setArivePipelineSyncEnabled(input: { id: string; enabled: boolean }) {
  try {
    const { row, actor } = await context(input?.id);
    if (typeof input.enabled !== 'boolean') throw new AriveError('Choose whether to enable or pause synchronization.');
    if (input.enabled && !await ariveConfigured()) throw new AriveError('Save the branch Arive connection first.');
    if (input.enabled && process.env.VERCEL_ENV === 'production' && !process.env.CRON_SECRET?.trim()) throw new AriveError('Background synchronization requires CRON_SECRET in Vercel. Configure the existing scheduled-job secret before enabling this pilot.');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${row.id}`}))`;
      const current = await tx.processingPipelineLoan.findUnique({ where: { id: row.id }, include: { loan: { include: { loanOfficer: { select: { email: true } } } } } });
      if (!current) throw new AriveError('Pipeline file not found.');
      assertAriveSyncPilot(current.loan);
      const now = new Date();
      await tx.arivePipelineSync.upsert({ where: { pipelineId: row.id }, create: { pipelineId: row.id, enabled: input.enabled, enabledById: actor.id, ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, nextAttemptAt: input.enabled ? now : null }, update: { enabled: input.enabled, enabledById: actor.id, nextAttemptAt: input.enabled ? now : null, leaseToken: null, leaseUntil: null } });
      await tx.auditLog.create({ data: { loanId: row.loanId, userId: actor.id, action: input.enabled ? 'PROCESSING_ARIVE_SYNC_ENABLED' : 'PROCESSING_ARIVE_SYNC_PAUSED', details: JSON.stringify({ processingPipelineLoanId: row.id, scope: ARIVE_SYNC_PILOT.loanNumber }) } });
    });
    const result = input.enabled ? await syncArivePipeline(row.id, { force: true }) : { success: true as const };
    revalidatePath('/pipeline');
    return result;
  } catch (error) { return failure(error); }
}
export async function syncArivePipelineNow(input: { id: string }) {
  try {
    const { row } = await context(input?.id);
    const state = await prisma.arivePipelineSync.findUnique({ where: { pipelineId: row.id }, select: { enabled: true } });
    if (!state?.enabled) throw new AriveError('Enable the test-file sync before refreshing.');
    const result = await syncArivePipeline(row.id, { force: true });
    revalidatePath('/pipeline');
    return result;
  } catch (error) { return failure(error); }
}

export async function acknowledgeArivePipelineConflicts(input: { id: string }) {
  try {
    const { row, actor } = await context(input?.id);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${row.id}`}))`;
      const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId: row.id } });
      if (!state) throw new AriveError('No Arive sync history exists for this file.');
      await tx.auditLog.create({ data: { loanId: row.loanId, userId: actor.id, action: 'PROCESSING_ARIVE_CONFLICTS_ACKNOWLEDGED', details: JSON.stringify({ processingPipelineLoanId: row.id, conflicts: state.conflicts }) } });
      await tx.arivePipelineSync.update({ where: { id: state.id }, data: { conflicts: [] } });
    });
    revalidatePath('/pipeline');
    return { success: true as const };
  } catch (error) { return failure(error); }
}
