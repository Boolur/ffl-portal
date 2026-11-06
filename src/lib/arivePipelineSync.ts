import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ProcessingPipelineLoan } from '@prisma/client';
import { prisma } from './prisma';
import { AriveError, ariveSession, readAriveNotes } from './ariveClient';
import { ARIVE_SYNC_PILOT, ariveSyncFieldLabel, type AriveSyncIssue } from './ariveSyncTypes';
import { ariveSyncSameValue, ariveSyncValue, jsonRecord, syncConflicts } from './ariveSyncState';
import { planArivePipelineSync } from './arivePipelineMapping';
import { parseAriveStructuredNotes, type AriveStructuredNoteKey, type AriveStructuredNoteSource } from './ariveStructuredNotes';
import { readPilotPackage } from './submissionPilot';

export const ARIVE_SYNC_INTERVAL_MS = 5 * 60_000;
const LEASE_MS = 4 * 60_000;
const READ_BUDGET_MS = 150_000;
type DB = typeof prisma;
type Api = Awaited<ReturnType<typeof ariveSession>>;
type SyncDeps = { db?: DB; session?: () => Promise<Api>; now?: () => Date };
type PilotLoan = { id: string; loanNumber: string; borrowerName: string; loanOfficerId: string; loanOfficer: { email: string } };

function normalized(value: unknown) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : ''; }
export function assertAriveSyncPilot(loan: PilotLoan) {
  if (loan.id !== ARIVE_SYNC_PILOT.loanId || loan.loanNumber !== ARIVE_SYNC_PILOT.loanNumber || loan.loanOfficerId !== ARIVE_SYNC_PILOT.ownerId || normalized(loan.borrowerName) !== 'testing tester' || !loan.loanOfficer.email) {
    throw new AriveError('Background integration is limited to the existing TESTING TESTER pilot file.');
  }
}
export function verifyAriveSyncIdentity(details: unknown, email: string, expectedGuid?: string | null): string {
  const d = jsonRecord(details);
  const borrowers = Array.isArray(d.loanBorrowers) ? d.loanBorrowers.map(jsonRecord).filter(b => b.applicantType === 'Borrower') : [];
  if (String(d.ariveLoanId) !== ARIVE_SYNC_PILOT.loanNumber || typeof d.sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(d.sysGUID) || expectedGuid && d.sysGUID !== expectedGuid || !email || normalized(d.loanOriginatorEmail) !== normalized(email) || borrowers.length !== 1 || normalized(borrowers[0].firstName) !== 'testing' || normalized(borrowers[0].lastName) !== 'tester') {
    throw new AriveError('Arive did not confirm the pilot loan, borrower, and originator. Existing portal values were retained.');
  }
  return d.sysGUID;
}
function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function safeJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
function notesPrevious(value: unknown): Partial<Record<AriveStructuredNoteKey, AriveStructuredNoteSource>> {
  // This JSON is written only by the synchronization service, not by client inputs.
  return jsonRecord(value) as Partial<Record<AriveStructuredNoteKey, AriveStructuredNoteSource>>;
}
const noteTargets: Partial<Record<AriveStructuredNoteKey, keyof ProcessingPipelineLoan>> = {
  pendingItems: 'missingItemsCurrentStatus', scheduledSigning: 'estimatedSigningAt', payoffExpiry: 'payoffExpiresAt',
};

/** GET-only remote read. A per-file lease prevents an older worker from overwriting a newer result. */
export async function syncArivePipeline(pipelineId: string, options: { force?: boolean } = {}, deps: SyncDeps = {}) {
  const db = deps.db || prisma; const clock = deps.now || (() => new Date());
  const started = clock(); const token = randomUUID();
  const claimed = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
    const row = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { include: { loanOfficer: { select: { email: true } } } } } });
    if (!row?.ariveSync?.enabled) return null;
    assertAriveSyncPilot(row.loan);
    const state = row.ariveSync;
    if (state.ariveLoanId !== ARIVE_SYNC_PILOT.loanNumber) throw new AriveError('The saved Arive loan link does not match this pilot.');
    if (state.leaseUntil && state.leaseUntil > started || !options.force && state.nextAttemptAt && state.nextAttemptAt > started) return null;
    // A manual refresh cannot flood Arive or overlap the scheduled worker.
    if (state.lastAttemptAt && started.getTime() - state.lastAttemptAt.getTime() < 10_000) return null;
    await tx.arivePipelineSync.update({ where: { id: state.id }, data: { leaseToken: token, leaseUntil: new Date(started.getTime() + LEASE_MS), lastAttemptAt: started } });
    return { row, state };
  });
  if (!claimed) return { success: true as const, skipped: true };

  try {
    const underlying = await (deps.session || ariveSession)();
    const api: Api = async (path, body, method) => {
      if (body || method) throw new AriveError('Pipeline synchronization only reads from Arive.');
      if (clock().getTime() - started.getTime() > READ_BUDGET_MS) throw new AriveError('Arive refresh exceeded its time budget. Existing values were retained.');
      return underlying(path);
    };
    let guid = claimed.state.ariveGuid;
    if (!guid) {
      const search = await api(`/loans?searchField=DISPLAY_ID&searchValue=${ARIVE_SYNC_PILOT.loanNumber}&limit=100&offset=0`);
      const matches = Array.isArray(search.rows) ? search.rows.filter((r: { ariveLoanId?: unknown }) => String(r.ariveLoanId) === ARIVE_SYNC_PILOT.loanNumber) : [];
      if (matches.length !== 1 || typeof matches[0].sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(matches[0].sysGUID)) throw new AriveError('Arive did not return one exact pilot-loan match.');
      guid = matches[0].sysGUID;
    }
    const path = `/loans/${encodeURIComponent(guid!)}`;
    const details = await api(path);
    guid = verifyAriveSyncIdentity(details, claimed.row.loan.loanOfficer.email, guid);
    const trackers = await api(`${path}/trackers`);
    const notes = await readAriveNotes(guid, api);
    const after = await api(path);
    verifyAriveSyncIdentity(after, claimed.row.loan.loanOfficer.email, guid);
    if (stable(details) !== stable(after)) throw new AriveError('The Arive file changed during this refresh. No partial update was applied; it will be retried.');
    const previousModified = jsonRecord(claimed.state.snapshot).modifiedDateTime;
    const modified = jsonRecord(details).modifiedDateTime;
    if (typeof previousModified === 'string' && typeof modified === 'string' && Date.parse(modified) < Date.parse(previousModified)) throw new AriveError('Arive returned an older loan snapshot. Existing values were retained.');

    return await db.$transaction(async tx => {
      // Submission approval holds its package lock before refreshing the pipeline.
      // Use the same order here; recheck the link after acquiring both locks.
      const linkSnapshot = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, select: { sourceTask: { select: { submissionData: true } } } });
      const lockedDocumentTaskId = jsonRecord(linkSnapshot?.sourceTask.submissionData).processingDocumentTaskId;
      if (typeof lockedDocumentTaskId === 'string') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${lockedDocumentTaskId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${pipelineId}`}))`;
      const current = await tx.processingPipelineLoan.findUnique({ where: { id: pipelineId }, include: { ariveSync: true, loan: { include: { loanOfficer: { select: { email: true } } } }, sourceTask: { select: { submissionData: true } } } });
      const state = current?.ariveSync; const now = clock();
      if (!current || !state?.enabled || state.leaseToken !== token || !state.leaseUntil || state.leaseUntil <= now) return { success: true as const, skipped: true };
      if (jsonRecord(current.sourceTask.submissionData).processingDocumentTaskId !== lockedDocumentTaskId) throw new AriveError('The submission link changed during this refresh. The refresh will be retried.');
      assertAriveSyncPilot(current.loan);
      if (current.loan.loanOfficer.email.toLowerCase() !== claimed.row.loan.loanOfficer.email.toLowerCase()) throw new AriveError('The loan originator changed during this refresh.');
      const previousSnapshot = jsonRecord(state.snapshot);
      const priorTrackers = jsonRecord(previousSnapshot.source).trackers;
      const priorLockTrackers = Array.isArray(priorTrackers) ? priorTrackers.map(jsonRecord).filter(t => t.name === 'RATE_LOCK') : [];
      const priorLockStatus = priorLockTrackers.length === 1 ? priorLockTrackers[0].status : null;
      // Retained portal values are not evidence of a new Arive observation. An
      // unavailable/unknown tracker must never make an old lock look newly confirmed.
      const priorLock = priorLockStatus === 'Locked' ? true : typeof priorLockStatus === 'string' && ['None', 'Requested', 'Expired', 'Rejected'].includes(priorLockStatus) ? false : undefined;
      const previousReadStartedAt = previousSnapshot.readStartedAt;
      const plan = planArivePipelineSync({ details, trackers, current: { ...current, ...(typeof priorLock === 'boolean' && typeof previousReadStartedAt === 'string' ? { previousArive: { rateLock: priorLock, observedAt: previousReadStartedAt } } : {}) }, now });
      const parsed = parseAriveStructuredNotes(notes, notesPrevious(state.fieldSources));
      const fieldSources = { ...jsonRecord(state.fieldSources) };
      const structuredValues = { ...jsonRecord(previousSnapshot.structuredValues) };
      const patch: Record<string, unknown> = { ...plan.patch };
      const issues: AriveSyncIssue[] = plan.issues.filter(issue => !['estimatedSigningAt', 'payoffExpiresAt'].includes(issue.field));
      const managed: Record<string, unknown> = { ...jsonRecord(previousSnapshot.managed), ...plan.managed };
      // Arive owns the stage and destination even when an early stage has no legacy enum equivalent.
      managed.pipelineStatus = patch.pipelineStatus ?? current.pipelineStatus;
      managed.sheet = patch.sheet ?? current.sheet;
      for (const [key, field] of Object.entries(parsed.fields)) {
        const typedKey = key as AriveStructuredNoteKey; const target = noteTargets[typedKey];
        if (field.action === 'KEEP') continue;
        structuredValues[key] = field.action === 'CLEAR' ? null : field.value;
        if (field.source) fieldSources[key] = field.source;
        if (target) {
          const value = field.action === 'CLEAR' ? null : target.endsWith('At') ? new Date(`${field.value}T00:00:00.000Z`) : field.value;
          patch[target] = value; managed[target] = value;
        }
      }
      for (const issue of parsed.issues) issues.push({ field: noteTargets[issue.field] || issue.field, code: issue.code, message: `${ariveSyncFieldLabel(noteTargets[issue.field] || issue.field)}: ${issue.code.replaceAll('_', ' ').toLowerCase()}. The previous value was retained; correct the source note in Arive.` });
      const effective = (field: keyof ProcessingPipelineLoan) => field in patch ? patch[field] : current[field];
      if ((plan.source.stage === 'DOCS_OUT' || plan.source.stage === 'DOCS_SIGNED') && !effective('estimatedSigningAt')) issues.push({ field: 'estimatedSigningAt', code: 'MISSING_SIGNING_DATE', message: 'Arive reports documents out/signed, but no valid Scheduled Signing note supplies a date.' });
      if (effective('payoffStatus') === 'RECEIVED' && !effective('payoffExpiresAt')) issues.push({ field: 'payoffExpiresAt', code: 'MISSING_PAYOFF_EXPIRY', message: 'Payoff is received, but no valid Payoff Expiry note supplies a date.' });

      const changes = Object.entries(patch).filter(([field, value]) => !ariveSyncSameValue(field, (current as unknown as Record<string, unknown>)[field], value));
      const priorManaged = jsonRecord(previousSnapshot.managed);
      const conflicts = [...syncConflicts(state.conflicts)];
      for (const [field, value] of changes) {
        const before = (current as unknown as Record<string, unknown>)[field];
        if (field in managed && (field in priorManaged ? !ariveSyncSameValue(field, before, priorManaged[field]) : ariveSyncValue(before) !== null)) conflicts.push({ field, label: ariveSyncFieldLabel(field), portalValue: ariveSyncValue(before), ariveValue: ariveSyncValue(value), detectedAt: now.toISOString() });
      }
      const content = { source: plan.source, managed, structuredValues, modifiedDateTime: typeof modified === 'string' ? modified : null };
      // Start time conservatively proves that a prior unlocked read happened
      // after a request. The observation clock itself is not a content change.
      const snapshot = { ...content, readStartedAt: started.toISOString() };
      const hash = createHash('sha256').update(stable({ snapshot: content, fieldSources, issues })).digest('hex');
      const changed = changes.length > 0 || hash !== state.snapshotHash;
      const data = Object.fromEntries(changes) as Prisma.ProcessingPipelineLoanUpdateManyMutationInput;
      if (changed) {
        data.version = { increment: 1 };
        const written = await tx.processingPipelineLoan.updateMany({ where: { id: current.id, version: current.version }, data });
        if (written.count !== 1) throw new AriveError('The portal file changed during this refresh. Existing values were retained.');
        await tx.auditLog.create({ data: { loanId: current.loanId, userId: state.enabledById, action: 'PROCESSING_ARIVE_SYNC_APPLIED', details: JSON.stringify({ processingPipelineLoanId: current.id, source: 'ARIVE', sourceStage: plan.source.stage, changes: changes.map(([field, value]) => ({ field, previous: ariveSyncValue((current as unknown as Record<string, unknown>)[field]), next: ariveSyncValue(value) })), issues, trigger: options.force ? 'MANUAL' : 'SCHEDULED', readStartedAt: started.toISOString() }) } });
      }
      if (plan.clearRateLockRequest && current.rateLockRequestedAt) await tx.auditLog.create({ data: { loanId: current.loanId, userId: state.enabledById, action: 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED', details: JSON.stringify({ processingPipelineLoanId: current.id, source: 'ARIVE', requestedAt: current.rateLockRequestedAt.toISOString(), requestedById: current.rateLockRequestedById, confirmationDate: ariveSyncValue(patch.rateLockConfirmedAt) }) } });

      // Keep the existing approved package's conversation current without changing its review history or routing.
      const documentTaskId = jsonRecord(current.sourceTask.submissionData).processingDocumentTaskId;
      if (typeof documentTaskId === 'string') {
        const documentTask = await tx.task.findUnique({ where: { id: documentTaskId } });
        const pkg = documentTask && readPilotPackage(documentTask.submissionData);
        if (documentTask?.loanId === current.loanId && pkg?.ariveLink?.id === guid && pkg.ariveLink.loanNumber === ARIVE_SYNC_PILOT.loanNumber && (!pkg.ariveNotes || pkg.ariveNotes.syncedAt < started.toISOString()) && stable(pkg.ariveNotes?.notes) !== stable(notes)) {
          pkg.ariveNotes = { syncedAt: started.toISOString(), notes }; pkg.revision++;
          const updated = await tx.task.updateMany({ where: { id: documentTask.id, updatedAt: documentTask.updatedAt }, data: { submissionData: safeJson({ ...jsonRecord(documentTask.submissionData), submissionPilot: pkg }) } });
          if (updated.count !== 1) throw new AriveError('The document package changed during this refresh. The refresh will be retried.');
        }
      }
      await tx.arivePipelineSync.update({ where: { id: state.id }, data: { ariveGuid: guid, lastSuccessAt: now, nextAttemptAt: new Date(now.getTime() + ARIVE_SYNC_INTERVAL_MS), failureCount: 0, lastError: null, leaseToken: null, leaseUntil: null, snapshot: safeJson(snapshot), fieldSources: safeJson(fieldSources), conflicts: safeJson(conflicts.slice(-30)), issues: safeJson(issues), snapshotHash: hash } });
      return { success: true as const, skipped: false, changed, issues: issues.length };
    }, { maxWait: 10_000, timeout: 20_000 });
  } catch (error) {
    const message = error instanceof AriveError ? error.message : 'Arive synchronization failed. The previous successful portal values were retained.';
    const count = claimed.state.failureCount + 1;
    await db.arivePipelineSync.updateMany({ where: { pipelineId, leaseToken: token }, data: { failureCount: count, lastError: message, nextAttemptAt: new Date(clock().getTime() + Math.min(60 * 60_000, ARIVE_SYNC_INTERVAL_MS * 2 ** Math.min(count - 1, 4))), leaseToken: null, leaseUntil: null } });
    return { success: false as const, error: message };
  }
}

export async function runDueArivePipelineSyncs(deps: SyncDeps = {}) {
  const db = deps.db || prisma; const now = (deps.now || (() => new Date()))();
  const due = await db.arivePipelineSync.findMany({ where: { enabled: true, ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, pipeline: { loanId: ARIVE_SYNC_PILOT.loanId, loan: { loanOfficerId: ARIVE_SYNC_PILOT.ownerId } }, AND: [{ OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }] }, select: { pipelineId: true }, take: 1 });
  const results = [];
  for (const row of due) results.push(await syncArivePipeline(row.pipelineId, {}, deps));
  return { checked: due.length, succeeded: results.filter(r => r.success && !r.skipped).length, failed: results.filter(r => !r.success).length };
}
