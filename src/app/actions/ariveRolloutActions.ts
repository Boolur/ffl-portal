'use server';

import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { AriveError, ariveReadOnlySession } from '@/lib/ariveClient';
import { AriveTransportError } from '@/lib/ariveTransport';
import { jsonRecord } from '@/lib/ariveSyncState';
import { configureAriveTransportQuota, getAriveTransportMetrics } from '@/lib/ariveTransportPrisma';
import { ARIVE_ROLLOUT_CONNECTION, ARIVE_ROLLOUT_OWNER, assertAriveRolloutReady, enrollAriveRolloutBatch, isArivePracticeFile, rolloutLoanSelect, stableAriveValue, verifyAriveRolloutIdentity } from '@/lib/ariveRollout';

async function admin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  if (!session?.user?.id || !isAdminIII(role)) throw new AriveError('Only Admin III can manage the Arive rollout.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, role: true, roles: true } });
  if (!user?.active || !role || ![user.role, ...user.roles].includes(role)) throw new AriveError('Your current account cannot manage the Arive rollout.');
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') throw new AriveError('Arive rollout controls are disabled on preview deployments.');
  return user;
}
const failure = (error: unknown) => ({ success: false as const, error: error instanceof AriveError || error instanceof AriveTransportError ? error.message : 'The Arive rollout operation could not be completed.' });
function id(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new AriveError('Choose an existing pipeline file.'); return value; }

export async function getAriveRolloutStatus(input: { cursor?: string } = {}) {
  try {
    await admin(); const cursor = input.cursor === undefined ? null : id(input.cursor);
    const [control, rows, transport, counts, freshness] = await Promise.all([
      prisma.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } }),
      prisma.arivePipelineSync.findMany({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, ...(cursor ? { pipelineId: { gt: cursor } } : {}) },
        select: { pipelineId: true, ariveLoanId: true, enabled: true, enrollmentStatus: true, enrollmentIssue: true, verifiedAt: true,
          lastSuccessAt: true, collectedAt: true, lastAttemptAt: true, nextAttemptAt: true, lastError: true, sourceStage: true, manualRefreshRequestedAt: true },
        orderBy: { pipelineId: 'asc' }, take: 51 }),
      getAriveTransportMetrics(),
      prisma.arivePipelineSync.groupBy({ by: ['enrollmentStatus', 'enabled'], where: { workerOwner: ARIVE_ROLLOUT_OWNER }, _count: { _all: true } }),
      prisma.arivePipelineSync.aggregate({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true }, _min: { lastSuccessAt: true, collectedAt: true }, _max: { lastSuccessAt: true, collectedAt: true }, _count: { _all: true, lastSuccessAt: true, collectedAt: true } }),
    ]);
    return { success: true as const, control: control ? { collectionEnabled: control.collectionEnabled, applicationEnabled: control.applicationEnabled,
      enrollmentEnabled: control.enrollmentEnabled, generation: control.generation, cohortLimit: control.cohortLimit } : { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, generation: 0, cohortLimit: 10 },
      rows: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].pipelineId : null, transport, counts, freshness };
  } catch (error) { return failure(error); }
}

export async function configureAriveRollout(input: { collectionEnabled: boolean; applicationEnabled: boolean; enrollmentEnabled: boolean; cohortLimit?: 10 | 50 | null }) {
  try {
    const actor = await admin();
    if (!input || [input.collectionEnabled, input.applicationEnabled, input.enrollmentEnabled].some(value => typeof value !== 'boolean')) throw new AriveError('Choose the rollout collection, application, and enrollment settings.');
    if (!input.collectionEnabled && (input.applicationEnabled || input.enrollmentEnabled)) throw new AriveError('Collection must be enabled before applying changes or enrolling files.');
    if (input.cohortLimit !== undefined && input.cohortLimit !== null && input.cohortLimit !== 10 && input.cohortLimit !== 50) throw new AriveError('Choose a cohort of 10, 50, or all eligible files.');
    if (input.collectionEnabled) {
      await assertAriveRolloutReady();
      if (process.env.VERCEL_ENV === 'production' && !process.env.CRON_SECRET?.trim()) throw new AriveError('Configure the scheduled-job secret before enabling rollout collection.');
    }
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      if (input.cohortLimit !== undefined && input.cohortLimit !== null && await tx.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true } }) > input.cohortLimit) throw new AriveError('Pause individual rollout files before lowering the cohort below its currently enabled file count.');
      const settings = { collectionEnabled: input.collectionEnabled, applicationEnabled: input.applicationEnabled, enrollmentEnabled: input.enrollmentEnabled,
        ...(input.cohortLimit !== undefined ? { cohortLimit: input.cohortLimit } : {}) };
      await tx.ariveRolloutControl.upsert({ where: { id: ARIVE_ROLLOUT_CONNECTION },
        create: { id: ARIVE_ROLLOUT_CONNECTION, ...settings, enabledById: actor.id, generation: 1 },
        update: { ...settings, enabledById: actor.id, generation: { increment: 1 } } });
      // Global generation fences in-flight reads without touching the legacy worker.
      await tx.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_ROLLOUT_CONTROL_CHANGED', details: JSON.stringify(settings) } });
    });
    return { success: true as const };
  } catch (error) { return failure(error); }
}

export async function configureAriveRolloutRequestAllowance(input: { providerRequestLimit: number; providerWindowSeconds: number; enabled: boolean }) {
  try {
    const actor = await admin();
    const result = await configureAriveTransportQuota(input);
    await prisma.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_REQUEST_ALLOWANCE_CONFIGURED', details: JSON.stringify({ providerRequestLimit: input.providerRequestLimit, providerWindowSeconds: input.providerWindowSeconds, enabled: input.enabled }) } });
    return { success: true as const, result };
  } catch (error) { return failure(error); }
}

export async function enrollAriveRolloutFiles() {
  try { await admin(); return { success: true as const, ...await enrollAriveRolloutBatch() }; }
  catch (error) { return failure(error); }
}

export async function verifyAndEnrollExistingAriveLoan(input: { pipelineId: string }) {
  try { await admin(); const pipelineId = id(input?.pipelineId); await assertAriveRolloutReady();
    return { success: true as const, ...await enrollAriveRolloutBatch({}, { pipelineId }) };
  } catch (error) { return failure(error); }
}

export async function queueAriveRolloutRefresh(input: { pipelineId: string }) {
  try {
    const actor = await admin(); const pipelineId = id(input?.pipelineId);
    await assertAriveRolloutReady();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId }, include: { pipeline: { select: { loanId: true } } } });
      if (!control?.collectionEnabled || !state?.enabled || state.workerOwner !== ARIVE_ROLLOUT_OWNER || state.enrollmentStatus !== 'VERIFIED') throw new AriveError('This file is not enabled for verified rollout collection.');
      if (await isArivePracticeFile(tx, state.ariveLoanId, state.ariveGuid)) throw new AriveError('Practice files cannot enter canonical synchronization.');
      if (!state.manualRefreshRequestedAt) {
        await tx.arivePipelineSync.update({ where: { pipelineId }, data: { manualRefreshRequestedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: actor.id, loanId: state.pipeline.loanId, action: 'ARIVE_ROLLOUT_REFRESH_QUEUED', details: JSON.stringify({ pipelineId }) } });
      }
    });
    return { success: true as const, queued: true as const };
  } catch (error) { return failure(error); }
}

export async function setAriveRolloutLoanEnabled(input: { pipelineId: string; enabled: boolean }) {
  try {
    const actor = await admin(); const pipelineId = id(input?.pipelineId);
    if (typeof input.enabled !== 'boolean') throw new AriveError('Choose whether to enable or pause this file.');
    if (input.enabled) await assertAriveRolloutReady();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId }, include: { pipeline: { select: { loanId: true } } } });
      if (!state || state.workerOwner !== ARIVE_ROLLOUT_OWNER) throw new AriveError('This control cannot change an existing legacy pilot file.');
      if (input.enabled && (state.enrollmentStatus !== 'VERIFIED' || await isArivePracticeFile(tx, state.ariveLoanId, state.ariveGuid))) throw new AriveError('Resolve enrollment before enabling this file.');
      const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      if (input.enabled && (!control?.collectionEnabled || !state.enabled && control.cohortLimit !== null && await tx.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true } }) >= control.cohortLimit)) throw new AriveError('Enable collection and increase the cohort limit before adding this file.');
      await tx.arivePipelineSync.update({ where: { pipelineId }, data: { enabled: input.enabled, enabledById: actor.id, leaseToken: null, leaseUntil: null,
        operatorPaused: !input.enabled, manualRefreshRequestedAt: null, nextAttemptAt: input.enabled ? new Date() : null } });
      await tx.auditLog.create({ data: { userId: actor.id, loanId: state.pipeline.loanId, action: input.enabled ? 'ARIVE_ROLLOUT_LOAN_ENABLED' : 'ARIVE_ROLLOUT_LOAN_PAUSED', details: JSON.stringify({ pipelineId }) } });
    });
    return { success: true as const };
  } catch (error) { return failure(error); }
}

/** Explicit cutover only: automatic enrollment never takes a legacy worker's row. */
export async function transferLegacyAriveRolloutFile(input: { pipelineId: string }) {
  try {
    const actor = await admin(); const pipelineId = id(input?.pipelineId); await assertAriveRolloutReady();
    const original = await prisma.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { select: rolloutLoanSelect } } });
    if (!original?.ariveSync || original.ariveSync.workerOwner !== 'LEGACY' || !original.ariveSync.ariveGuid) throw new AriveError('Choose an existing, linked legacy pilot file.');
    const api = await ariveReadOnlySession();
    const matched = verifyAriveRolloutIdentity(await api(`/loans/${encodeURIComponent(original.ariveSync.ariveGuid)}`), original.loan, original.ariveSync);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      const current = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { select: rolloutLoanSelect } } });
      const state = current?.ariveSync;
      if (!control?.collectionEnabled || !current || !state || state.workerOwner !== 'LEGACY' || state.workerGeneration !== original.ariveSync!.workerGeneration
        || state.ariveGuid !== original.ariveSync!.ariveGuid || current.version !== original.version || stableAriveValue(current.loan) !== stableAriveValue(original.loan)) throw new AriveError('The legacy file or rollout settings changed. Reopen the cutover review.');
      if (await isArivePracticeFile(tx, state.ariveLoanId, state.ariveGuid)) throw new AriveError('A practice file cannot become canonical.');
      if (state.enabled && control.cohortLimit !== null && await tx.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true } }) >= control.cohortLimit) throw new AriveError('The rollout cohort is full. Increase its limit before transferring this file.');
      await tx.arivePipelineSync.update({ where: { pipelineId }, data: { workerOwner: ARIVE_ROLLOUT_OWNER, workerGeneration: { increment: 1 },
        connectionId: ARIVE_ROLLOUT_CONNECTION, enabledById: actor.id, enrollmentStatus: 'VERIFIED', enrollmentIssue: null,
        verifiedAt: new Date(), verifiedOriginatorEmail: matched.originatorEmail, sourceStage: typeof jsonRecord(jsonRecord(state.snapshot).source).stage === 'string' ? String(jsonRecord(jsonRecord(state.snapshot).source).stage) : null,
        everFunded: state.everFunded || current.sheet === 'FUNDING' || current.fundedAt !== null || current.loan.payrollCompRequests.length > 0,
        operatorPaused: !state.enabled, leaseToken: null, leaseUntil: null, nextAttemptAt: state.enabled ? new Date() : null } });
      await tx.auditLog.create({ data: { userId: actor.id, loanId: current.loanId, action: 'ARIVE_ROLLOUT_LEGACY_HANDOFF', details: JSON.stringify({ pipelineId, previousGeneration: state.workerGeneration, nextGeneration: state.workerGeneration + 1, keptEnabled: state.enabled }) } });
    });
    return { success: true as const };
  } catch (error) { return failure(error); }
}

/** Register an already-created synthetic Arive file; never creates one remotely. */
export async function registerPracticeAriveLoan(input: { ariveLoanId: string; label: string; ariveGuid?: string }) {
  try {
    const actor = await admin();
    if (!input || !/^\d{1,15}$/.test(input.ariveLoanId) || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 160
      || input.ariveGuid !== undefined && !/^[a-zA-Z0-9-]{1,100}$/.test(input.ariveGuid)) throw new AriveError('Enter the synthetic Arive loan number, a short label, and its optional permanent ID.');
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      const linked = await tx.arivePipelineSync.findFirst({ where: { OR: [{ ariveLoanId: input.ariveLoanId }, ...(input.ariveGuid ? [{ ariveGuid: input.ariveGuid }] : [])] }, select: { id: true } });
      const existingLoan = await tx.loan.findUnique({ where: { loanNumber: input.ariveLoanId }, select: { id: true } });
      if (linked || existingLoan) throw new AriveError('This Arive file already has a production portal loan or pipeline link. It cannot be registered as practice.');
      await tx.arivePracticeLoan.upsert({ where: { ariveLoanId: input.ariveLoanId }, create: { ariveLoanId: input.ariveLoanId, label: input.label.trim(), ariveGuid: input.ariveGuid ?? null, createdById: actor.id }, update: { label: input.label.trim(), ...(input.ariveGuid ? { ariveGuid: input.ariveGuid } : {}) } });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_PRACTICE_FILE_REGISTERED', details: JSON.stringify({ ariveLoanId: input.ariveLoanId, label: input.label.trim() }) } });
    });
    return { success: true as const };
  } catch (error) { return failure(error); }
}

export async function getAriveRolloutReview(input: { pipelineId: string }) {
  try {
    await admin(); const pipelineId = id(input?.pipelineId);
    const state = await prisma.arivePipelineSync.findUnique({ where: { pipelineId }, select: { workerOwner: true, collectedSnapshot: true, collectedAt: true, enrollmentStatus: true, enrollmentIssue: true, lastSuccessAt: true } });
    if (!state || state.workerOwner !== ARIVE_ROLLOUT_OWNER) throw new AriveError('No generalized rollout review exists for this file.');
    // Only the worker's allowlisted projection is exposed, never provider bodies,
    // credentials, tokens, raw applied-state metadata, or practice task records.
    return { success: true as const, ...state };
  } catch (error) { return failure(error); }
}
