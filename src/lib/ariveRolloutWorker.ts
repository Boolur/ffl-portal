import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ProcessingPipelineLoan } from '@prisma/client';
import { prisma } from './prisma';
import { AriveError, ariveReadOnlySession, readAriveNotes } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
import { ariveSyncFieldLabel, type AriveSyncIssue } from './ariveSyncTypes';
import { ariveSyncSameValue, ariveSyncValue, jsonRecord, syncConflicts } from './ariveSyncState';
import { ariveRouteAfterApply, planAriveRolloutSync } from './arivePipelineMapping';
import { parseAriveStructuredNotes, type AriveStructuredNoteKey, type AriveStructuredNoteSource } from './ariveStructuredNotes';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';
import {
  ARIVE_ACTIVE_INTERVAL_MS, ARIVE_QUIET_INTERVAL_MS, ARIVE_ROLLOUT_CONNECTION, ARIVE_ROLLOUT_OWNER,
  ariveRolloutEnvironmentEnabled, ariveRolloutJson, assertAriveRolloutReady, isArivePracticeFile,
  rolloutLoanSelect, stableAriveValue, verifyAriveRolloutIdentity, type AriveRolloutDeps,
} from './ariveRollout';

const LEASE_MS = 4 * 60_000;
const READ_BUDGET_MS = 150_000;
const MAX_SCHEDULED_ATTEMPTS = 500;
const SCHEDULED_WAVE_HEADROOM_MS = 75_000;
const WORKER_DEADLINE_RETRY_MS = 60_000;
// Faster successful polling must not shorten the existing failure backoff.
const RETRY_BASE_MS = 5 * 60_000;
const noteTargets: Partial<Record<AriveStructuredNoteKey, keyof ProcessingPipelineLoan>> = {
  pendingItems: 'missingItemsCurrentStatus', scheduledSigning: 'estimatedSigningAt', payoffExpiry: 'payoffExpiresAt',
};
function previousObservation(snapshot: Record<string, unknown>) {
  const trackers = jsonRecord(snapshot.source).trackers;
  const one = (name: string) => { const matches = Array.isArray(trackers) ? trackers.map(jsonRecord).filter(t => t.name === name) : []; return matches.length === 1 ? matches[0] : {}; };
  const lock = one('RATE_LOCK').status;
  const rateLock = lock === 'Locked' ? true : typeof lock === 'string' && ['None', 'Requested', 'Expired', 'Rejected'].includes(lock) ? false : undefined;
  const appraisal = one('APPRAISAL').status; const needed = jsonRecord(snapshot.managed).appraisalNeeded;
  return {
    ...(typeof rateLock === 'boolean' && typeof snapshot.readStartedAt === 'string' ? { rateLock, observedAt: snapshot.readStartedAt } : {}),
    ...(typeof appraisal === 'string' && typeof needed === 'boolean' ? { appraisal: { status: appraisal, needed } } : {}),
  };
}
function nextInterval(row: Pick<ProcessingPipelineLoan, 'sheet' | 'archivedAt'>) { return row.sheet === 'FUNDING' || row.archivedAt ? ARIVE_QUIET_INTERVAL_MS : ARIVE_ACTIVE_INTERVAL_MS; }
function hash(value: unknown) { return createHash('sha256').update(stableAriveValue(value)).digest('hex'); }

/** Owns GENERALIZED rows only. Reads Arive, then atomically applies or collects a preview. */
export async function syncAriveRolloutLoan(pipelineId: string, deps: AriveRolloutDeps = {}) {
  const db = deps.db || prisma; const clock = deps.now || (() => new Date()); const started = clock(); const token = randomUUID();
  if (!ariveRolloutEnvironmentEnabled()) return { success: true as const, skipped: true };
  await assertAriveRolloutReady(deps);
  const claimed = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
    const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
    if (!control?.collectionEnabled) return null;
    const row = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { select: rolloutLoanSelect } } });
    const state = row?.ariveSync;
    if (!row || !state?.enabled || state.workerOwner !== ARIVE_ROLLOUT_OWNER || state.enrollmentStatus !== 'VERIFIED' || state.connectionId !== ARIVE_ROLLOUT_CONNECTION) return null;
    if (state.ariveLoanId !== row.loan.loanNumber || !state.ariveGuid || !state.verifiedOriginatorEmail) throw new AriveError('The verified Arive link is incomplete. Review enrollment before syncing.');
    if (await isArivePracticeFile(tx, state.ariveLoanId, state.ariveGuid)) return null;
    if (state.leaseUntil && state.leaseUntil > started || state.nextAttemptAt && state.nextAttemptAt > started && (!state.manualRefreshRequestedAt || state.failureCount > 0)) return null;
    if (state.lastAttemptAt && started.getTime() - state.lastAttemptAt.getTime() < 10_000) return null;
    if (await tx.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, leaseUntil: { gt: started }, leaseToken: { not: null } } }) >= 2) return null;
    // Manual archives never become a background reopening candidate. Older
    // funded files remain refreshable on demand without permanent fast polling.
    const route = jsonRecord(state.routingProvenance);
    if (row.archivedAt && route.kind !== 'ARCHIVE' && !state.manualRefreshRequestedAt) return null;
    if (row.sheet === 'FUNDING' && row.fundedAt && row.fundedAt.getTime() < started.getTime() - 90 * 24 * 60 * 60_000 && !state.manualRefreshRequestedAt) return null;
    await tx.arivePipelineSync.update({ where: { id: state.id }, data: { leaseToken: token, leaseUntil: new Date(started.getTime() + LEASE_MS), lastAttemptAt: started, manualRefreshRequestedAt: null } });
    return { row, state, control };
  });
  if (!claimed) return { success: true as const, skipped: true };

  try {
    const underlying = await (deps.session || ariveReadOnlySession)();
    const api: Awaited<ReturnType<typeof ariveReadOnlySession>> = async (path, body, method) => {
      if (body || method) throw new AriveError('Canonical synchronization only reads from Arive.');
      if (clock().getTime() - started.getTime() > READ_BUDGET_MS) throw new AriveError('Arive refresh exceeded its time budget. The previous applied snapshot was retained.');
      if (deps.deadlineMs && Date.now() >= deps.deadlineMs - 25_000) throw new AriveTransportError('WORKER_DEADLINE', 'This refresh was deferred to the next worker run. The previous complete snapshot was retained.', new Date(clock().getTime() + WORKER_DEADLINE_RETRY_MS));
      return underlying(path);
    };
    const path = `/loans/${encodeURIComponent(claimed.state.ariveGuid!)}`;
    const details = await api(path);
    verifyAriveRolloutIdentity(details, claimed.row.loan, claimed.state);
    const trackers = await api(`${path}/trackers`);
    const notes = await readAriveNotes(claimed.state.ariveGuid!, api);
    const after = await api(path);
    verifyAriveRolloutIdentity(after, claimed.row.loan, claimed.state);
    if (stableAriveValue(details) !== stableAriveValue(after)) throw new AriveError('The Arive file changed during this refresh. No partial update was applied.');
    const modified = jsonRecord(details).modifiedDateTime;
    const previousModified = jsonRecord(claimed.state.snapshot).modifiedDateTime;
    if (typeof modified === 'string' && typeof previousModified === 'string' && Date.parse(modified) < Date.parse(previousModified)) throw new AriveError('Arive returned an older snapshot. The current portal values were retained.');

    return await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const control = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      const current = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { select: rolloutLoanSelect } } });
      const state = current?.ariveSync; const now = clock();
      if (!current || !state || !ariveRolloutEnvironmentEnabled() || !control?.collectionEnabled || control.generation !== claimed.control.generation
        || !state.enabled || state.workerOwner !== ARIVE_ROLLOUT_OWNER || state.workerGeneration !== claimed.state.workerGeneration
        || state.enrollmentStatus !== 'VERIFIED' || state.leaseToken !== token || !state.leaseUntil || state.leaseUntil <= now
        || await isArivePracticeFile(tx, state.ariveLoanId, state.ariveGuid)) {
        await tx.arivePipelineSync.updateMany({ where: { pipelineId, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } });
        return { success: true as const, skipped: true };
      }
      if (state.connectionId !== claimed.state.connectionId || state.ariveLoanId !== claimed.state.ariveLoanId || state.ariveGuid !== claimed.state.ariveGuid || state.verifiedOriginatorEmail !== claimed.state.verifiedOriginatorEmail) throw new AriveError('The Arive link changed during this refresh. Retry after reviewing enrollment.');
      verifyAriveRolloutIdentity(details, current.loan, state);
      const previousSnapshot = jsonRecord(state.snapshot);
      const plan = planAriveRolloutSync({ details, trackers, current: { ...current, previousArive: previousObservation(previousSnapshot) }, now,
        everFunded: state.everFunded || jsonRecord(state.collectedSnapshot).everFunded === true || current.loan.payrollCompRequests.length > 0,
        routingProvenance: state.routingProvenance, generation: state.workerGeneration });
      const parsed = parseAriveStructuredNotes(notes, jsonRecord(state.fieldSources) as Partial<Record<AriveStructuredNoteKey, AriveStructuredNoteSource>>);
      const fieldSources = { ...jsonRecord(state.fieldSources) }; const structuredValues = { ...jsonRecord(previousSnapshot.structuredValues) };
      const patch: Record<string, unknown> = { ...plan.patch };
      const managed: Record<string, unknown> = { ...jsonRecord(previousSnapshot.managed), ...plan.managed };
      const issues: AriveSyncIssue[] = plan.issues.filter(issue => !['estimatedSigningAt', 'payoffExpiresAt'].includes(issue.field));
      // Protect the retained route as well as changed source-owned values.
      managed.pipelineStatus = patch.pipelineStatus ?? current.pipelineStatus; managed.sheet = patch.sheet ?? current.sheet;
      for (const [key, field] of Object.entries(parsed.fields)) {
        const target = noteTargets[key as AriveStructuredNoteKey]; if (field.action === 'KEEP') continue;
        structuredValues[key] = field.action === 'CLEAR' ? null : field.value;
        if (field.source) fieldSources[key] = field.source;
        if (target) { const value = field.action === 'CLEAR' ? null : target.endsWith('At') ? new Date(`${field.value}T00:00:00.000Z`) : field.value; patch[target] = value; managed[target] = value; }
      }
      for (const issue of parsed.issues) issues.push({ field: noteTargets[issue.field] || issue.field, code: issue.code, message: `${ariveSyncFieldLabel(noteTargets[issue.field] || issue.field)}: ${issue.code.replaceAll('_', ' ').toLowerCase()}. The previous value was retained; correct the source note in Arive.` });
      const effective = (field: keyof ProcessingPipelineLoan) => field in patch ? patch[field] : current[field];
      if (['DOCS_OUT', 'DOCS_SIGNED'].includes(plan.source.stage) && !effective('estimatedSigningAt')) issues.push({ field: 'estimatedSigningAt', code: 'MISSING_SIGNING_DATE', message: 'Documents are out/signed, but no valid Scheduled Signing note supplies a date.' });
      if (effective('payoffStatus') === 'RECEIVED' && !effective('payoffExpiresAt')) issues.push({ field: 'payoffExpiresAt', code: 'MISSING_PAYOFF_EXPIRY', message: 'Payoff is received, but no valid Payoff Expiry note supplies a date.' });
      const changes = Object.entries(patch).filter(([field, value]) => !ariveSyncSameValue(field, (current as unknown as Record<string, unknown>)[field], value));
      const content = { source: plan.source, managed, structuredValues, application: projectAriveApplicationSnapshot(details), modifiedDateTime: typeof modified === 'string' ? modified : null };
      const snapshot = { ...content, readStartedAt: started.toISOString() };
      const snapshotHash = hash({ snapshot: content, fieldSources, issues });
      const collectedSnapshot = ariveRolloutJson({ source: plan.source, application: content.application, structuredValues, notes, issues, everFunded: plan.everFunded,
        changes: changes.map(([field, value]) => ({ field, previous: ariveSyncValue((current as unknown as Record<string, unknown>)[field]), next: ariveSyncValue(value) })) });
      if (!control.applicationEnabled) {
        await tx.arivePipelineSync.update({ where: { id: state.id }, data: {
          collectedSnapshot, collectedAt: now, nextAttemptAt: new Date(now.getTime() + nextInterval(current)),
          failureCount: 0, lastError: null, leaseToken: null, leaseUntil: null,
        } });
        return { success: true as const, skipped: false, applied: false, changed: false, issues: issues.length };
      }
      const conflicts = [...syncConflicts(state.conflicts)]; const priorManaged = jsonRecord(previousSnapshot.managed);
      for (const [field, value] of changes) {
        const before = (current as unknown as Record<string, unknown>)[field];
        if (field in managed && (field in priorManaged ? !ariveSyncSameValue(field, before, priorManaged[field]) : ariveSyncValue(before) !== null)) conflicts.push({ field, label: ariveSyncFieldLabel(field), portalValue: ariveSyncValue(before), ariveValue: ariveSyncValue(value), detectedAt: now.toISOString() });
      }
      const notesHash = hash(notes);
      const oldNotes = await tx.ariveLoanNotes.findUnique({ where: { pipelineId }, select: { contentHash: true } });
      const changed = changes.length > 0 || snapshotHash !== state.snapshotHash || oldNotes?.contentHash !== notesHash;
      if (changed) {
        const data = { ...Object.fromEntries(changes), version: { increment: 1 } } as Prisma.ProcessingPipelineLoanUpdateManyMutationInput;
        const written = await tx.processingPipelineLoan.updateMany({ where: { id: pipelineId, version: current.version }, data });
        if (written.count !== 1) throw new AriveError('The portal file changed during this refresh. Existing values were retained.');
        await tx.auditLog.create({ data: { loanId: current.loanId, userId: state.enabledById, action: 'PROCESSING_ARIVE_SYNC_APPLIED', details: JSON.stringify({ pipelineId, worker: ARIVE_ROLLOUT_OWNER, generation: state.workerGeneration, sourceStage: plan.source.stage, changes: jsonRecord(collectedSnapshot).changes, issues, trigger: claimed.state.manualRefreshRequestedAt ? 'MANUAL_QUEUE' : 'SCHEDULED' }) } });
      }
      if (oldNotes?.contentHash !== notesHash) await tx.ariveLoanNotes.upsert({ where: { pipelineId }, create: { pipelineId, notes: ariveRolloutJson(notes), contentHash: notesHash, syncedAt: now }, update: { notes: ariveRolloutJson(notes), contentHash: notesHash, syncedAt: now } });
      if (plan.clearRateLockRequest && current.rateLockRequestedAt) await tx.auditLog.create({ data: { loanId: current.loanId, userId: state.enabledById, action: 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED', details: JSON.stringify({ pipelineId, source: 'ARIVE', requestedAt: current.rateLockRequestedAt.toISOString(), requestedById: current.rateLockRequestedById, confirmationDate: ariveSyncValue(patch.rateLockConfirmedAt) }) } });
      const routing = ariveRouteAfterApply(current, plan, state.routingProvenance, state.workerGeneration, current.version + (changed ? 1 : 0));
      await tx.arivePipelineSync.update({ where: { id: state.id }, data: {
        sourceStage: plan.source.stage || null, everFunded: plan.everFunded, routingProvenance: ariveRolloutJson(routing ?? {}),
        snapshot: ariveRolloutJson(snapshot), snapshotHash, fieldSources: ariveRolloutJson(fieldSources), conflicts: ariveRolloutJson(conflicts.slice(-30)), issues: ariveRolloutJson(issues),
        collectedSnapshot, collectedAt: now, lastSuccessAt: now, nextAttemptAt: new Date(now.getTime() + nextInterval({ ...current, ...plan.patch })),
        failureCount: 0, lastError: null, leaseToken: null, leaseUntil: null,
      } });
      return { success: true as const, skipped: false, applied: true, changed, issues: issues.length };
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    const deferred = error instanceof AriveTransportError;
    const localDeadline = deferred && error.code === 'WORKER_DEADLINE';
    const message = error instanceof AriveError || deferred ? error.message : 'Arive synchronization failed. The previous applied values were retained.';
    await db.$transaction(async tx => {
      const owner = { pipelineId, leaseToken: token, workerOwner: ARIVE_ROLLOUT_OWNER, workerGeneration: claimed.state.workerGeneration };
      // On-demand-only files (old fundings/manual archives) still need a queued
      // request to remain eligible after a failed read. Keep any newer request.
      if (claimed.state.manualRefreshRequestedAt) await tx.arivePipelineSync.updateMany({
        where: { ...owner, manualRefreshRequestedAt: null },
        data: { manualRefreshRequestedAt: claimed.state.manualRefreshRequestedAt },
      });
      await tx.arivePipelineSync.updateMany({ where: owner, data: {
        // A spent invocation budget is local scheduling, not a provider error.
        // Keep any previous failure history without starting exponential backoff.
        ...(!localDeadline ? { failureCount: claimed.state.failureCount + 1, lastError: message } : {}),
        leaseToken: null, leaseUntil: null,
        nextAttemptAt: deferred && error.retryAt && error.retryAt > clock() ? error.retryAt : new Date(clock().getTime() + Math.min(ARIVE_QUIET_INTERVAL_MS, RETRY_BASE_MS * 2 ** Math.min(claimed.state.failureCount, 4))),
      } });
    });
    return { success: false as const, error: message, deferred, localDeadline };
  }
}

export async function runDueAriveRolloutSyncs(deps: AriveRolloutDeps = {}) {
  const db = deps.db || prisma; const now = (deps.now || (() => new Date()))();
  if (!ariveRolloutEnvironmentEnabled()) return { checked: 0, succeeded: 0, failed: 0 };
  const control = await db.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
  if (!control?.collectionEnabled) return { checked: 0, succeeded: 0, failed: 0 };
  await assertAriveRolloutReady(deps);
  const deadlineMs = deps.deadlineMs ?? Date.now() + 150_000;
  const attempted: string[] = []; const results: Awaited<ReturnType<typeof syncAriveRolloutLoan>>[] = [];
  while (attempted.length < MAX_SCHEDULED_ATTEMPTS && Date.now() < deadlineMs - SCHEDULED_WAVE_HEADROOM_MS) {
  const due = await db.arivePipelineSync.findMany({ where: {
    enabled: true, workerOwner: ARIVE_ROLLOUT_OWNER, connectionId: ARIVE_ROLLOUT_CONNECTION, enrollmentStatus: 'VERIFIED',
    pipelineId: { notIn: attempted },
    AND: [
      { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }, { manualRefreshRequestedAt: { not: null }, failureCount: 0 }] },
      { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      { OR: [{ manualRefreshRequestedAt: { not: null } }, { pipeline: { archivedAt: null, sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } } },
        { pipeline: { archivedAt: null, sheet: 'FUNDING', fundedAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60_000) } } },
        { routingProvenance: { path: ['kind'], equals: 'ARCHIVE' } }] },
    ],
  }, select: { pipelineId: true }, orderBy: [
    { manualRefreshRequestedAt: { sort: 'asc', nulls: 'last' } },
    { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
    { pipelineId: 'asc' },
  ], take: Math.min(2, MAX_SCHEDULED_ATTEMPTS - attempted.length) });
  // The due query can wait on the database; recheck before taking file leases.
  if (!due.length || Date.now() >= deadlineMs - SCHEDULED_WAVE_HEADROOM_MS) break;
  attempted.push(...due.map(row => row.pipelineId));
  const wave = await Promise.all(due.map(row => syncAriveRolloutLoan(row.pipelineId, { ...deps, deadlineMs })));
  results.push(...wave);
  if (wave.some(result => !result.success && result.deferred) || wave.every(result => result.success && result.skipped)) break;
  }
  return { checked: attempted.length, succeeded: results.filter(r => r.success && !r.skipped).length, failed: results.filter(r => !r.success && !r.localDeadline).length };
}
