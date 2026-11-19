'use server';

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { Prisma, UserRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { AriveError, ariveReadOnlySession, readAriveNotes } from '@/lib/ariveClient';
import { AriveTransportError } from '@/lib/ariveTransport';
import { isAriveBudgetReady } from '@/lib/ariveTransportPrisma';
import { ariveRolloutJson, isArivePracticeFile, stableAriveValue } from '@/lib/ariveRollout';
import { projectAriveApplicationSnapshot } from '@/lib/ariveApplicationSnapshot';
import { normalizeAriveIdentity } from '@/lib/ariveIdentity';
import { jsonRecord } from '@/lib/ariveSyncState';
import { planAriveOneTimeReconciliation } from '@/lib/ariveOneTimeReconciliation';
import { getAriveOneTimeManifest, type AriveOneTimeManifestEntry as Entry } from '@/lib/ariveOneTimeManifest';

// Deliberately fixed, reviewed mappings. This is not an arbitrary enrollment or write API.


type Db = Prisma.TransactionClient;
type Plan = ReturnType<typeof planAriveOneTimeReconciliation>;
const PREPARED = 'ARIVE_ONE_TIME_RECONCILIATION_PREPARED';
const APPLIED = 'ARIVE_ONE_TIME_RECONCILIATION_APPLIED';
const MAX_AGE = 15 * 60_000;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const hash = (value: unknown) => createHash('sha256').update(stableAriveValue(plain(value))).digest('hex');
function requireValue(value: unknown, message: string): asserts value { if (!value) throw new AriveError(message); }
const failure = (error: unknown) => ({ success: false as const, error: error instanceof AriveError || error instanceof AriveTransportError ? error.message : error instanceof Error && /^[A-Z][A-Z_]{5,100}$/.test(error.message) ? `The source verification stopped: ${error.message}. No update was applied.` : 'The reconciliation was not applied. Refresh the review and try again; no partial change was saved.' });
export type AriveOneTimePreview = { planId: string; digest: string; borrower: string; ariveLoanId: string; sourceStage: string | null; changes: Plan['changes']; issues: Plan['issues']; noteCount: number; expiresAt: string };
export type AriveOneTimeStatus = { success: true; rows: { pipelineId: string; borrower: string; oldNumber: string; ariveLoanId: string; appliedAt: string | null }[]; controls: { paused: boolean; generation: number } };

async function admin(expectedId?: string, db: Db = prisma) {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  requireValue(session?.user?.id && role && isAdminIII(role) && (!expectedId || expectedId === session.user.id), 'Sign in with your current Admin III account to review these seven files.');
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, role: true, roles: true } });
  requireValue(user?.active && [user.role, ...user.roles].includes(role), 'Your administrator access changed. Sign in again.');
  requireValue(!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production', 'This reconciliation is available only on production.');
  return user;
}
async function environment(db: Db = prisma) {
  const [control, connection, enabled, leases] = await Promise.all([
    db.ariveRolloutControl.findUnique({ where: { id: 'company' } }),
    db.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { encryptedCredentials: true, updatedAt: true } }),
    db.arivePipelineSync.count({ where: { enabled: true } }),
    db.arivePipelineSync.count({ where: { leaseUntil: { gt: new Date() } } }),
  ]);
  return { paused: !!control && !control.collectionEnabled && !control.applicationEnabled && !control.enrollmentEnabled && !enabled && !leases,
    generation: control?.generation ?? -1, controlRevision: control?.updatedAt.toISOString() ?? '', credentialRevision: connection?.updatedAt.toISOString() ?? '', credentialHash: connection ? hash(connection.encryptedCredentials) : '' };
}
type Environment = Awaited<ReturnType<typeof environment>>;
function checkEnvironment(current: Environment, expected?: Environment) {
  requireValue(current.paused && current.credentialHash && current.generation >= 0, 'Keep collection, enrollment and application paused, with no enabled files or active worker leases, before this one-time review.');
  requireValue(!expected || hash(current) === hash(expected), 'The connection or synchronization controls changed. Prepare a new review.');
}
function key() { requireValue(process.env.NEXTAUTH_SECRET, 'Secure review storage is unavailable.'); return createHash('sha256').update(`arive-one-time-plan:v1:${process.env.NEXTAUTH_SECRET}`).digest(); }
function seal(value: unknown) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), encrypted: encrypted.toString('base64') });
}
function unseal(text: string) {
  const data = JSON.parse(text); requireValue(data.version === 1, 'This saved review is no longer supported.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data.encrypted, 'base64')), decipher.final()]).toString('utf8')) as SavedPlan;
}
async function source(entry: Entry, db: Db = prisma) {
  const row = await db.processingPipelineLoan.findUnique({ where: { id: entry.pipelineId }, include: { loan: { include: { loanOfficer: { select: { email: true } }, secondaryLoanOfficer: { select: { email: true } } } }, ariveSync: true, notesSnapshot: true } });
  requireValue(row && row.loanId === entry.loanId, 'The reviewed portal file is no longer available.');
  const [tasks, payroll, packages] = await Promise.all([
    db.task.findMany({ where: { loanId: entry.loanId }, orderBy: { id: 'asc' } }),
    db.payrollCompRequest.findMany({ where: { OR: [{ loanId: entry.loanId }, { loanNumber: { in: [entry.oldNumber, entry.ariveLoanId] } }] }, include: { splits: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    db.pilotPracticeTask.findMany({ where: { sourceLoanId: entry.loanId }, select: { id: true, updatedAt: true }, orderBy: { id: 'asc' } }),
  ]);
  return { row, tasks, payroll, packages };
}
type Source = Awaited<ReturnType<typeof source>>;
function checkSource(s: Source, entry: Entry) {
  requireValue(s.row.loan.loanNumber === entry.oldNumber && s.row.version === entry.version && normalizeAriveIdentity(s.row.loan.borrowerName) === normalizeAriveIdentity(entry.borrower), 'This portal identity or version changed after the reviewed seven-file list. A new investigation is required.');
  requireValue(s.row.sheet === 'PIPELINE' && !s.row.archivedAt && !s.row.fundedAt, 'This file has already moved or been funded. Review its current routing before continuing.');
  const sync = s.row.ariveSync;
  requireValue(sync && !sync.enabled && !sync.ariveGuid && !sync.lastSuccessAt && sync.ariveLoanId === entry.oldNumber && !Object.keys(jsonRecord(sync.snapshot)).length && !Object.keys(jsonRecord(sync.collectedSnapshot)).length, 'This file already has a collected or verified link. It cannot use this initial reconciliation.');
  requireValue(s.tasks.length === entry.tasks.length && s.tasks.every(t => (entry.tasks as readonly string[]).includes(t.id) && jsonRecord(t.submissionData).arriveLoanNumber === entry.oldNumber), 'The task references changed. Prepare a separately reviewed correction instead.');
  requireValue(!s.packages.length && s.tasks.every(t => !jsonRecord(t.submissionData).submissionPilot), 'A pilot submission package now references this file. Review its identifiers before changing the loan number.');
}
async function checkDuplicates(entry: Entry, guid?: string, db: Db = prisma) {
  const [loans, syncs, practice] = await Promise.all([
    db.loan.findMany({ where: { id: { not: entry.loanId } }, select: { loanNumber: true } }),
    db.arivePipelineSync.count({ where: { pipelineId: { not: entry.pipelineId }, OR: [{ ariveLoanId: entry.ariveLoanId }, ...(guid ? [{ ariveGuid: guid }] : [])] } }),
    isArivePracticeFile(db, entry.ariveLoanId, guid),
  ]);
  requireValue(!loans.some(l => l.loanNumber.trim().replace(/^0+(?=\d)/, '') === entry.ariveLoanId) && !syncs && !practice, 'This Arive identity is already linked or registered for practice. No correction was applied.');
}
function protectedHash(s: Source) {
  const { loan } = s.row;
  const pipeline = s.row;
  const loanFields = ['stage', 'pipelineStageId', 'clientId', 'loanOfficerId', 'secondaryLoanOfficerId', 'visibilitySubmitterUserId', 'processorId', 'createdAt'];
  const pipelineFields = ['loanId', 'sourceTaskId', 'seniorProcessorId', 'juniorProcessorId', 'assignmentGroup', 'processingMethod', 'dateAssigned', 'projectedRevenue', 'finalRevenue', 'leadSource', 'extraNotes', 'restructureNotes', 'appraisalNotes', 'createdAt'];
  const pick = (v: unknown, fields: string[]) => Object.fromEntries(fields.map(k => [k, (v as Record<string, unknown>)[k]]));
  return hash({ loan: pick(loan, loanFields), pipeline: pick(pipeline, pipelineFields), payroll: s.payroll, packages: s.packages,
    tasks: s.tasks.map(t => { const data = { ...jsonRecord(t.submissionData) }; delete data.arriveLoanNumber; return { ...t, submissionData: data, updatedAt: null }; }) });
}
function address(value: string) {
  return value.toUpperCase().replace(/\b(NORTH|SOUTH|EAST|WEST|STREET|AVENUE|DRIVE|LANE|ROAD|BOULEVARD|COURT)\b/g, word => ({ NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', STREET: 'ST', AVENUE: 'AVE', DRIVE: 'DR', LANE: 'LN', ROAD: 'RD', BOULEVARD: 'BLVD', COURT: 'CT' })[word]!).replace(/[^A-Z0-9]/g, '');
}
function approvedIdentity(entry: Entry, details: unknown, guid: string) {
  const application = projectAriveApplicationSnapshot(details);
  const allowedNames = [entry.sourceName, entry.borrower];
  const applicants = application.applicants.filter(p => p.role === 'Borrower' && allowedNames.some(name => normalizeAriveIdentity(`${p.firstName} ${p.lastName}`) === normalizeAriveIdentity(name)));
  const property = application.property;
  requireValue(applicants.length === 1 && applicants[0].firstName && applicants[0].lastName, 'Arive did not return the specifically reviewed primary borrower. No fuzzy match was accepted.');
  requireValue(property && property.addressTbd !== true && address(property.street || '') === address(entry.street) && address(property.city || '') === address(entry.city) && property.state?.toUpperCase() === entry.state && property.postalCode?.slice(0, 5) === entry.zip, 'Arive property details no longer match the independently reviewed address. No update was applied.');
  return { portalLoanId: entry.loanId, previousLoanNumber: entry.oldNumber, ariveLoanId: entry.ariveLoanId, ariveGuid: guid, borrowerFirstName: applicants[0].firstName!, borrowerLastName: applicants[0].lastName!, applicationSequence: applicants[0].applicationSequence };
}
type SavedPlan = { version: 1; planId: string; actorId: string; pipelineId: string; manifestEntryHash: string; preparedAt: string; readStartedAt: string; environment: Environment; sourceHash: string; protectedHash: string; plan: Plan };
function preview(saved: SavedPlan, entry: Entry): AriveOneTimePreview {
  return { planId: saved.planId, digest: hash(saved), borrower: entry.borrower, ariveLoanId: entry.ariveLoanId, sourceStage: saved.plan.sourceStage, changes: saved.plan.changes,
    issues: saved.plan.issues, noteCount: saved.plan.notes.length, expiresAt: new Date(Date.parse(saved.readStartedAt) + MAX_AGE).toISOString() };
}

export async function getAriveOneTimeReconciliationStatus() {
  try {
    await admin();
    const manifest = await getAriveOneTimeManifest();
    const [env, applied] = await Promise.all([environment(), prisma.auditLog.findMany({ where: { action: APPLIED, loanId: { in: manifest.map(e => e.loanId) } }, select: { loanId: true, createdAt: true }, orderBy: { createdAt: 'desc' } })]);
    const status: AriveOneTimeStatus = { success: true, controls: { paused: env.paused, generation: env.generation }, rows: manifest.map(e => ({ pipelineId: e.pipelineId, borrower: e.borrower, oldNumber: e.oldNumber, ariveLoanId: e.ariveLoanId, appliedAt: applied.find(a => a.loanId === e.loanId)?.createdAt.toISOString() ?? null })) };
    return status;
  } catch (error) { return failure(error); }
}

export async function prepareAriveOneTimeReconciliation(input: { pipelineId: string }) {
  try {
    const actor = await admin(); const manifest = await getAriveOneTimeManifest(); const entry = manifest.find(e => e.pipelineId === input?.pipelineId);
    requireValue(entry, 'Only the seven specifically reviewed files can use this action.');
    const env = await environment(); checkEnvironment(env);
    const before = await source(entry); checkSource(before, entry); await checkDuplicates(entry);
    const ready = await isAriveBudgetReady(); requireValue(ready.ready, ready.reason || 'Shared Arive requests are temporarily unavailable.');
    const readStartedAt = new Date(); const underlying = await ariveReadOnlySession();
    const api: Awaited<ReturnType<typeof ariveReadOnlySession>> = async (path, body, method) => {
      requireValue(!body && !method && Date.now() - readStartedAt.getTime() < 150_000, 'The read exceeded its safe time window. Prepare it again.');
      await admin(actor.id); checkEnvironment(await environment(), env); return underlying(path);
    };
    const found = await api(`/loans?searchField=DISPLAY_ID&searchValue=${entry.ariveLoanId}&limit=100&offset=0`);
    requireValue(Array.isArray(found.rows) && found.rows.length < 100 && (found.count === undefined || Number.isSafeInteger(found.count) && found.count === found.rows.length), 'Arive returned an incomplete exact-loan search.');
    const matches = (found.rows as unknown[]).map(jsonRecord).filter(r => String(r.ariveLoanId) === entry.ariveLoanId);
    requireValue(matches.length === 1 && typeof matches[0].sysGUID === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(matches[0].sysGUID), 'Arive did not return one unique, valid permanent identity.');
    const guid = matches[0].sysGUID as string; await checkDuplicates(entry, guid);
    const path = `/loans/${encodeURIComponent(guid)}`; const details = await api(path);
    const approved = approvedIdentity(entry, details, guid);
    const trackers = await api(`${path}/trackers`); const notes = await readAriveNotes(guid, api); const after = await api(path);
    requireValue(hash(details) === hash(after), 'The Arive file changed during the read. Prepare a fresh review.');
    await admin(actor.id); checkEnvironment(await environment(), env);
    const current = await source(entry); requireValue(hash(current) === hash(before), 'The portal file, tasks or financial records changed during the read. Prepare a new review.');
    const plan = planAriveOneTimeReconciliation({ approved, loan: current.row.loan, current: current.row, previous: current.row.ariveSync, details, trackers, notes, generation: env.generation, now: new Date(), readStartedAt,
      financialHistoryProtected: current.payroll.some(p => p.paidAt || ['APPROVED', 'PAID'].includes(p.status) || p.fundedImportKey) });
    const saved: SavedPlan = plain({ version: 1, planId: randomUUID(), actorId: actor.id, pipelineId: entry.pipelineId, manifestEntryHash: hash(entry), preparedAt: new Date().toISOString(), readStartedAt: readStartedAt.toISOString(), environment: env, sourceHash: hash(current), protectedHash: protectedHash(current), plan });
    requireValue(JSON.stringify(saved).length <= 2_000_000, 'The complete source snapshot exceeds this one-time review limit.');
    // Encrypted and not a PROCESSING_ action: generic borrower activity never receives the private plan.
    await prisma.auditLog.create({ data: { id: saved.planId, userId: actor.id, action: PREPARED, details: seal(saved) } });
    return { success: true as const, preview: preview(saved, entry) };
  } catch (error) { return failure(error); }
}

export async function applyAriveOneTimeReconciliation(input: { planId: string; digest: string }) {
  try {
    const actor = await admin();
    requireValue(input && /^[a-f0-9-]{36}$/i.test(input.planId) && /^[a-f0-9]{64}$/.test(input.digest), 'Select a valid prepared review.');
    const audit = await prisma.auditLog.findUnique({ where: { id: input.planId } });
    requireValue(audit?.action === PREPARED && audit.userId === actor.id && audit.details, 'This review is unavailable or belongs to another administrator.');
    const saved = unseal(audit.details); const manifest = await getAriveOneTimeManifest(); const entry = manifest.find(e => e.pipelineId === saved.pipelineId);
    requireValue(entry && saved.version === 1 && saved.planId === audit.id && saved.actorId === actor.id && hash(saved) === input.digest
      && saved.manifestEntryHash === hash(entry) && saved.plan.verifiedIdentity.ariveLoanId === entry.ariveLoanId, 'The review does not match its saved source or approved private scope. Prepare it again.');
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${entry.pipelineId}`}))`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR SHARE`;
      await admin(actor.id, tx);
      const liveManifest = await getAriveOneTimeManifest(tx);
      requireValue(hash(liveManifest.find(item => item.pipelineId === entry.pipelineId) ?? null) === saved.manifestEntryHash, 'The approved private scope changed. Prepare a new review.');
      await tx.$queryRaw`SELECT id FROM "AriveRolloutControl" WHERE id = 'company' FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "AriveIntegrationConfig" WHERE id = 'company' FOR SHARE`;
      checkEnvironment(await environment(tx), saved.environment);
      const prior = await tx.auditLog.findFirst({ where: { action: APPLIED, loanId: entry.loanId }, orderBy: { createdAt: 'desc' } });
      if (prior) {
        requireValue(jsonRecord(JSON.parse(prior.details || '{}')).planId === saved.planId, 'This file was already reconciled through another review.');
        return { success: true as const, alreadyApplied: true, appliedAt: prior.createdAt.toISOString() };
      }
      const age = Date.now() - Date.parse(saved.readStartedAt);
      requireValue(Number.isFinite(age) && age >= 0 && age <= MAX_AGE, 'This review is older than fifteen minutes. Read Arive again before applying.');
      await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${entry.loanId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ProcessingPipelineLoan" WHERE id = ${entry.pipelineId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Task" WHERE "loanId" = ${entry.loanId} ORDER BY id FOR UPDATE`;
      const current = await source(entry, tx); checkSource(current, entry);
      requireValue(hash(current) === saved.sourceHash && protectedHash(current) === saved.protectedHash, 'Portal data, assignments, tasks or financial records changed since this review. Prepare it again.');
      await checkDuplicates(entry, saved.plan.verifiedIdentity.ariveGuid, tx);
      const plan = saved.plan; const now = new Date();
      const loanWritten = await tx.loan.updateMany({ where: { id: entry.loanId, loanNumber: entry.oldNumber, updatedAt: current.row.loan.updatedAt }, data: plan.loanPatch });
      requireValue(loanWritten.count === 1, 'The loan changed while applying the review.');
      const patch = Object.fromEntries(Object.entries(plan.pipelinePatch).map(([field, value]) => [field, field.endsWith('At') && typeof value === 'string' ? new Date(value) : value]));
      const written = await tx.processingPipelineLoan.updateMany({ where: { id: entry.pipelineId, version: current.row.version }, data: { ...patch, version: { increment: 1 } } as Prisma.ProcessingPipelineLoanUpdateManyMutationInput });
      requireValue(written.count === 1, 'The pipeline file changed while applying the review.');
      // Only these live identifier aliases change. All historical facts, decisions, attachments and workflow state remain intact.
      for (const task of current.tasks) {
        const taskWritten = await tx.task.updateMany({ where: { id: task.id, loanId: entry.loanId, updatedAt: task.updatedAt }, data: { submissionData: ariveRolloutJson({ ...jsonRecord(task.submissionData), arriveLoanNumber: entry.ariveLoanId }), updatedAt: task.updatedAt } });
        requireValue(taskWritten.count === 1, 'A submission task changed while applying the review.');
      }
      await tx.ariveLoanNotes.upsert({ where: { pipelineId: entry.pipelineId }, create: { pipelineId: entry.pipelineId, notes: ariveRolloutJson(plan.notes), contentHash: plan.notesHash, syncedAt: now }, update: { notes: ariveRolloutJson(plan.notes), contentHash: plan.notesHash, syncedAt: now } });
      await tx.arivePipelineSync.update({ where: { pipelineId: entry.pipelineId }, data: {
        ariveLoanId: entry.ariveLoanId, ariveGuid: plan.verifiedIdentity.ariveGuid, enabled: false, enabledById: actor.id, operatorPaused: true, workerOwner: 'GENERALIZED', workerGeneration: saved.environment.generation, connectionId: 'company',
        enrollmentStatus: 'VERIFIED', enrollmentIssue: null, verifiedAt: now, verifiedOriginatorEmail: plan.verifiedIdentity.verifiedOriginatorEmail, sourceStage: plan.sourceStage, everFunded: plan.everFunded, routingProvenance: ariveRolloutJson(plan.routingProvenance),
        snapshot: ariveRolloutJson(plan.snapshot), snapshotHash: plan.snapshotHash, fieldSources: ariveRolloutJson(plan.fieldSources), conflicts: ariveRolloutJson(plan.conflicts), issues: ariveRolloutJson(plan.issues),
        collectedSnapshot: ariveRolloutJson(plan.collectedSnapshot), collectedAt: now, lastAttemptAt: now, lastSuccessAt: now, nextAttemptAt: null, manualRefreshRequestedAt: null, failureCount: 0, lastError: null, leaseToken: null, leaseUntil: null,
      } });
      requireValue(protectedHash(await source(entry, tx)) === saved.protectedHash, 'A protected assignment, financial or workflow field changed. The entire correction was rolled back.');
      checkEnvironment(await environment(tx), saved.environment);
      await tx.auditLog.create({ data: { userId: actor.id, loanId: entry.loanId, action: APPLIED, details: JSON.stringify({ planId: saved.planId, digest: input.digest, pipelineId: entry.pipelineId, previousLoanNumber: entry.oldNumber, ariveLoanId: entry.ariveLoanId, sourceStage: plan.sourceStage, changes: plan.changes, issues: plan.issues, sourceHash: saved.sourceHash, protectedHash: saved.protectedHash, taskAliases: current.tasks.map(t => ({ taskId: t.id, field: 'arriveLoanNumber', previous: entry.oldNumber, next: entry.ariveLoanId })), automaticSyncEnabled: false }) } });
      return { success: true as const, alreadyApplied: false, appliedAt: now.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    // A cache invalidation failure must not misreport a successfully committed transaction.
    try { for (const path of ['/pipeline', '/tasks', '/fundings', '/restructures', '/admin/arive/reconciliation']) revalidatePath(path); } catch { /* The next page load reads the saved result. */ }
    return result;
  } catch (error) { return failure(error); }
}
