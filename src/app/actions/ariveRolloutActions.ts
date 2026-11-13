'use server';

import { getServerSession } from 'next-auth';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { AriveError, ariveReadOnlySession, ariveSession } from '@/lib/ariveClient';
import { AriveTransportError } from '@/lib/ariveTransport';
import { jsonRecord } from '@/lib/ariveSyncState';
import { configureAriveOperatorBudget, configureAriveTransportQuota, getAriveTransportMetrics, sharedAriveTransportEnabled } from '@/lib/ariveTransportPrisma';
import { ARIVE_ACTIVE_INTERVAL_MS, ARIVE_QUIET_INTERVAL_MS, ARIVE_ROLLOUT_CONNECTION, ARIVE_ROLLOUT_OWNER, ariveRolloutCohortWhere, ariveRolloutEnvironmentEnabled, assertAriveRolloutReady, enrollAriveRolloutBatch, isArivePracticeFile, rolloutLoanSelect, stableAriveValue, verifyAriveRolloutIdentity } from '@/lib/ariveRollout';
import { ARIVE_SYNC_PILOT } from '@/lib/ariveSyncTypes';
import { sampleAriveTestReadTiming } from '@/lib/ariveReadTiming';

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
          lastSuccessAt: true, collectedAt: true, lastAttemptAt: true, nextAttemptAt: true, lastError: true, sourceStage: true, manualRefreshRequestedAt: true,
          pipeline: { select: { sheet: true, loan: { select: { borrowerName: true } } } } },
        orderBy: { pipelineId: 'asc' }, take: 51 }),
      getAriveTransportMetrics(),
      prisma.arivePipelineSync.groupBy({ by: ['enrollmentStatus', 'enabled'], where: { workerOwner: ARIVE_ROLLOUT_OWNER }, _count: { _all: true } }),
      prisma.arivePipelineSync.aggregate({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true }, _min: { lastSuccessAt: true, collectedAt: true }, _max: { lastSuccessAt: true, collectedAt: true }, _count: { _all: true, lastSuccessAt: true, collectedAt: true } }),
    ]);
    return { success: true as const, control: control ? { collectionEnabled: control.collectionEnabled, applicationEnabled: control.applicationEnabled,
      enrollmentEnabled: control.enrollmentEnabled, generation: control.generation, cohortLimit: control.cohortLimit } : { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, generation: 0, cohortLimit: 10 },
      rows: rows.slice(0, 50).map(({ pipeline, ...row }) => ({ ...row, sheet: pipeline.sheet, borrowerName: pipeline.loan.borrowerName })), nextCursor: rows.length > 50 ? rows[49].pipelineId : null, transport, counts, freshness };
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

export async function configureAriveRolloutOperatorBudget(input: { requestsPerMinute: number; enabled: boolean }) {
  try {
    const actor = await admin();
    if (!input || typeof input.enabled !== 'boolean' || !Number.isSafeInteger(input.requestsPerMinute) || input.requestsPerMinute < 10 || input.requestsPerMinute > 600) throw new AriveError('Choose an operator cap between 10 and 600 requests per minute.');
    const result = await configureAriveOperatorBudget({ requestsPerMinute: input.requestsPerMinute, enabled: input.enabled, authorizedById: actor.id });
    await prisma.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_OPERATOR_BUDGET_AUTHORIZED', details: JSON.stringify({ requestsPerMinute: input.requestsPerMinute, enabled: input.enabled, allowanceSource: 'OPERATOR_AUTHORIZED', providerConfirmed: false }) } });
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
    const readiness = await assertAriveRolloutReady({}, { allowCooldown: true });
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
    if (readiness.cooldownUntil && readiness.cooldownUntil > new Date()) return { success: true as const, queued: true as const };
    // Durable queue first; attempt the same shared worker immediately. Its
    // leases, budget and repeat guard apply to button clicks and scheduled work.
    const { syncAriveRolloutLoan } = await import('@/lib/ariveRolloutWorker');
    try {
      const result = await syncAriveRolloutLoan(pipelineId);
      if (result.success && !result.skipped && 'applied' in result) return { success: true as const, queued: false as const, applied: result.applied, collected: !result.applied, changed: 'changed' in result ? result.changed : false };
      if (!result.success && !result.deferred) return failure(new AriveError(result.error));
    } catch (error) {
      if (!(error instanceof AriveTransportError)) return failure(error);
    }
    return { success: true as const, queued: true as const };
  } catch (error) { return failure(error); }
}

/** Queues the existing verified cohort only; the scheduled worker owns every read. */
export async function queueAriveRolloutCohortRefresh() {
  try {
    const actor = await admin();
    await assertAriveRolloutReady({}, { allowCooldown: true });
    const queuedCount = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      if (!ariveRolloutEnvironmentEnabled() || !control?.collectionEnabled || !control.enabledById) throw new AriveError('Enable authorized rollout collection before queuing the cohort.');
      const queued = await tx.arivePipelineSync.updateMany({
        where: { enabled: true, workerOwner: ARIVE_ROLLOUT_OWNER, enrollmentStatus: 'VERIFIED', connectionId: ARIVE_ROLLOUT_CONNECTION, operatorPaused: false, manualRefreshRequestedAt: null },
        data: { manualRefreshRequestedAt: new Date() },
      });
      await tx.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_ROLLOUT_COHORT_REFRESH_QUEUED', details: JSON.stringify({ queuedCount: queued.count }) } });
      return queued.count;
    });
    return { success: true as const, queued: true as const, queuedCount };
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

/** Database-only inventory; does not discover or import additional Arive loans. */
export async function getAriveRolloutInventory(input: { cursor?: string } = {}) {
  try {
    await admin(); const cursor = input.cursor === undefined ? null : id(input.cursor);
    const cohort = ariveRolloutCohortWhere(new Date());
    const [rows, counts, practice, test] = await Promise.all([
      prisma.processingPipelineLoan.findMany({ where: { ...cohort, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 51,
        select: { id: true, sheet: true, loan: { select: { loanNumber: true, borrowerName: true } }, ariveSync: { select: { enrollmentStatus: true, enrollmentIssue: true, enabled: true } } } }),
      prisma.processingPipelineLoan.groupBy({ by: ['sheet'], where: cohort, _count: { _all: true } }),
      prisma.arivePracticeLoan.findMany({ select: { ariveLoanId: true, label: true, ariveGuid: true, enabled: true }, orderBy: { createdAt: 'asc' }, take: 100 }),
      prisma.processingPipelineLoan.findFirst({ where: { loanId: ARIVE_SYNC_PILOT.loanId, loan: { loanNumber: ARIVE_SYNC_PILOT.loanNumber, loanOfficerId: ARIVE_SYNC_PILOT.ownerId } },
        select: { id: true, loan: { select: { borrowerName: true } }, ariveSync: { select: { ariveGuid: true, enabled: true, workerOwner: true } } } }),
    ]);
    return { success: true as const,
      gates: { rollout: ariveRolloutEnvironmentEnabled(), sharedTransport: sharedAriveTransportEnabled() },
      targets: { activeSeconds: ARIVE_ACTIVE_INTERVAL_MS / 1000, quietSeconds: ARIVE_QUIET_INTERVAL_MS / 1000 },
      candidates: rows.slice(0, 50).map(row => ({ pipelineId: row.id, borrowerName: row.loan.borrowerName, loanNumber: row.loan.loanNumber, sheet: row.sheet,
        reason: row.ariveSync?.enrollmentIssue ?? null, enrollmentStatus: row.ariveSync?.enrollmentStatus ?? null, enabled: row.ariveSync?.enabled ?? false })),
      nextCursor: rows.length > 50 ? rows[49].id : null,
      counts: counts.map(row => ({ sheet: row.sheet, count: row._count._all })),
      tests: [
        ...(test ? [{ ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, label: test.loan.borrowerName, ariveGuid: test.ariveSync?.ariveGuid ?? null,
          kind: test.ariveSync?.workerOwner === ARIVE_ROLLOUT_OWNER ? 'GENERALIZED' as const : 'LEGACY' as const, enabled: test.ariveSync?.enabled ?? false, pipelineId: test.id }] : []),
        ...practice.map(row => ({ ...row, kind: 'PRACTICE' as const, pipelineId: null })),
      ],
    };
  } catch (error) { return failure(error); }
}

/** A single known test-file GET, bounded to once per minute across operators. */
export async function inspectAriveReportedAllowance() {
  try {
    const actor = await admin();
    const test = await prisma.arivePipelineSync.findFirst({ where: { ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, pipeline: { loanId: ARIVE_SYNC_PILOT.loanId, loan: { loanOfficerId: ARIVE_SYNC_PILOT.ownerId } } }, select: { ariveGuid: true } });
    if (!test?.ariveGuid || !/^[a-zA-Z0-9-]{1,100}$/.test(test.ariveGuid)) throw new AriveError('Link TESTING TESTER before checking the provider response limit.');
    const checkedAt = new Date();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-allowance-probe'))`;
      if (await tx.auditLog.findFirst({ where: { OR: [
        { action: 'ARIVE_ALLOWANCE_PROBE_STARTED', createdAt: { gt: new Date(checkedAt.getTime() - 60_000) } },
        { action: 'ARIVE_READ_TIMING_STARTED', createdAt: { gt: new Date(checkedAt.getTime() - 10 * 60_000) } },
      ] }, select: { id: true } })) throw new AriveError('Wait at least one minute after a limit check, or ten minutes after a timing sample, before checking again.');
      await tx.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_ALLOWANCE_PROBE_STARTED', details: '{}' } });
    });
    const reported: { limit: number | null; remaining: number | null } = { limit: null, remaining: null };
    const integerHeader = (headers: Headers, name: string) => { const value = headers.get(name)?.trim(); return value && /^\d{1,7}$/.test(value) ? Number(value) : null; };
    const api = await ariveSession(undefined, (headers, operation) => {
      if (operation !== 'API request') return;
      reported.limit = integerHeader(headers, 'x-ratelimit-limit');
      reported.remaining = integerHeader(headers, 'x-ratelimit-remaining');
    });
    await api(`/loans/${encodeURIComponent(test.ariveGuid)}`);
    const providerRequestLimit = reported.limit !== null && reported.limit >= 2 && reported.limit <= 1_000_000 ? reported.limit : null;
    await prisma.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_ALLOWANCE_PROBE_COMPLETED', details: JSON.stringify({ providerRequestLimit, providerWindowSeconds: 60, remaining: reported.remaining }) } });
    return { success: true as const, checkedAt: checkedAt.toISOString(), providerRequestLimit, providerWindowSeconds: 60 as const, remaining: reported.remaining,
      message: providerRequestLimit ? `Arive reports ${providerRequestLimit} requests per minute in its documented response header.` : 'Arive did not return a usable request-limit header. No allowance has been guessed or activated.' };
  } catch (error) { return failure(error); }
}

/** Bounded diagnostic only, never an allowance confirmation or enrollment path. */
export async function measureAriveTestReadTiming() {
  try {
    const actor = await admin();
    if (sharedAriveTransportEnabled()) throw new AriveError('This bounded diagnostic is available before shared synchronization is activated. Use live collection timestamps and request metrics while it is active.');
    const test = await prisma.arivePipelineSync.findFirst({ where: { ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, pipeline: { loanId: ARIVE_SYNC_PILOT.loanId, loan: { loanOfficerId: ARIVE_SYNC_PILOT.ownerId } } }, select: { ariveGuid: true } });
    if (!test?.ariveGuid || !/^[a-zA-Z0-9-]{1,100}$/.test(test.ariveGuid)) throw new AriveError('Link TESTING TESTER before measuring response times.');
    const checkedAt = new Date();
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-allowance-probe'))`;
      if (await tx.auditLog.findFirst({ where: { OR: [
        { action: 'ARIVE_READ_TIMING_STARTED', createdAt: { gt: new Date(checkedAt.getTime() - 10 * 60_000) } },
        { action: 'ARIVE_ALLOWANCE_PROBE_STARTED', createdAt: { gt: new Date(checkedAt.getTime() - 60_000) } },
      ] }, select: { id: true } })) throw new AriveError('Wait ten minutes between timing samples and one minute after a limit check.');
      await tx.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_READ_TIMING_STARTED', details: '{}' } });
    });
    const api = await ariveSession();
    const sample = await sampleAriveTestReadTiming(api, test.ariveGuid);
    const activeLoans = await prisma.processingPipelineLoan.count({ where: { archivedAt: null, sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } } });
    const apiOnlySweepEstimateSeconds = sample.meanCycleApiMs === null ? null : Math.ceil(activeLoans * sample.meanCycleApiMs / 2 / 1000);
    const timing = { ...sample, checkedAt: checkedAt.toISOString(), activeLoans, apiOnlySweepEstimateSeconds };
    await prisma.auditLog.create({ data: { userId: actor.id, action: 'ARIVE_READ_TIMING_COMPLETED', details: JSON.stringify(timing) } });
    return { success: true as const, timing };
  } catch (error) { return failure(error); }
}

export async function acknowledgeAriveRolloutConflicts(input: { pipelineId: string }) {
  try {
    const actor = await admin(); const pipelineId = id(input?.pipelineId);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId }, select: { workerOwner: true, conflicts: true, pipeline: { select: { loanId: true } } } });
      if (!state || state.workerOwner !== ARIVE_ROLLOUT_OWNER) throw new AriveError('Choose a generalized Arive file to acknowledge its conflicts.');
      await tx.auditLog.create({ data: { userId: actor.id, loanId: state.pipeline.loanId, action: 'ARIVE_ROLLOUT_CONFLICTS_ACKNOWLEDGED', details: JSON.stringify({ pipelineId, conflicts: state.conflicts }) } });
      await tx.arivePipelineSync.update({ where: { pipelineId }, data: { conflicts: [] } });
    });
    return { success: true as const };
  } catch (error) { return failure(error); }
}
