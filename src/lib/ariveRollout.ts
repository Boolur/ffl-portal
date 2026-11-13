import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { AriveError, ariveReadOnlySession } from './ariveClient';
import { isAriveBudgetReady } from './ariveTransportPrisma';
import { AriveTransportError } from './ariveTransport';
import { jsonRecord } from './ariveSyncState';

export const ARIVE_ROLLOUT_CONNECTION = 'company';
export const ARIVE_ROLLOUT_OWNER = 'GENERALIZED';
export const ARIVE_ACTIVE_INTERVAL_MS = 60_000;
export const ARIVE_QUIET_INTERVAL_MS = 60 * 60_000;
const ENROLLMENT_BATCH_SIZE = 25;
export type AriveRolloutDeps = {
  db?: typeof prisma; session?: typeof ariveReadOnlySession; now?: () => Date;
  budgetReady?: typeof isAriveBudgetReady;
  deadlineMs?: number;
};
export const ariveRolloutEnvironmentEnabled = () => process.env.ARIVE_ROLLOUT_ENABLED === 'true'
  && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production');
export async function assertAriveRolloutReady(deps: AriveRolloutDeps = {}, options: { allowCooldown?: boolean } = {}) {
  if (!ariveRolloutEnvironmentEnabled()) throw new AriveError('The generalized Arive rollout is disabled in this deployment.');
  const budget = await (deps.budgetReady || isAriveBudgetReady)(options.allowCooldown ? { allowCooldown: true } : undefined);
  if (!budget.ready && budget.cooldownUntil) throw new AriveTransportError('COOLDOWN', budget.reason || 'Arive requests are paused until the provider cooldown ends.', budget.cooldownUntil);
  if (!budget.ready) throw new AriveError(budget.reason || 'Confirm the branch API request allowance before collecting pipeline data.');
  return budget;
}
export function ariveRolloutCohortWhere(now: Date): Prisma.ProcessingPipelineLoanWhereInput {
  return { archivedAt: null, OR: [
    { sheet: { in: ['PIPELINE', 'RESTRUCTURE'] } },
    { sheet: 'FUNDING', fundedAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60_000) } },
    // Missing dates need an enrollment exception, not silent exclusion.
    { sheet: 'FUNDING', fundedAt: null },
  ] };
}
export type AriveRolloutLoanIdentity = {
  id: string; loanNumber: string; borrowerName: string; borrowerFirstName: string | null; borrowerLastName: string | null;
  loanOfficer: { email: string }; secondaryLoanOfficer: { email: string } | null;
};
export const rolloutLoanSelect = {
  id: true, loanNumber: true, borrowerName: true, borrowerFirstName: true, borrowerLastName: true,
  loanOfficer: { select: { email: true } }, secondaryLoanOfficer: { select: { email: true } },
  payrollCompRequests: { where: { OR: [{ paidAt: { not: null } }, { status: { in: ['APPROVED', 'PAID'] } }, { fundedImportKey: { not: null } }] }, select: { id: true }, take: 1 },
} satisfies Prisma.LoanSelect;
const normalize = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
export function verifyAriveRolloutIdentity(details: unknown, loan: AriveRolloutLoanIdentity, saved?: { ariveGuid?: string | null; verifiedOriginatorEmail?: string | null }) {
  const d = jsonRecord(details);
  if (!/^\d{1,15}$/.test(loan.loanNumber) || String(d.ariveLoanId) !== loan.loanNumber
    || typeof d.sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(d.sysGUID)
    || saved?.ariveGuid && d.sysGUID !== saved.ariveGuid) throw new AriveError('The Arive loan number or permanent identity does not match this portal file.');
  const email = normalize(d.loanOriginatorEmail);
  const allowed = [loan.loanOfficer.email, loan.secondaryLoanOfficer?.email].map(normalize).filter(Boolean);
  if (!email || !allowed.includes(email) || saved?.verifiedOriginatorEmail && email !== normalize(saved.verifiedOriginatorEmail)) {
    throw new AriveError('The Arive originator does not match the verified portal originator. Review this link before syncing.');
  }
  const first = normalize(loan.borrowerFirstName); const last = normalize(loan.borrowerLastName);
  const expected = first && last ? `${first} ${last}` : normalize(loan.borrowerName);
  const borrowers = Array.isArray(d.loanBorrowers) ? d.loanBorrowers.map(jsonRecord).filter(b => b.applicantType === 'Borrower') : [];
  if (!expected || !borrowers.some(b => `${normalize(b.firstName)} ${normalize(b.lastName)}` === expected)) {
    throw new AriveError('The Arive borrower does not exactly match this existing portal loan. Review the link; no fuzzy match was applied.');
  }
  return { guid: d.sysGUID, originatorEmail: email };
}
export async function isArivePracticeFile(db: Pick<typeof prisma, 'arivePracticeLoan'>, number: string, guid?: string | null) {
  // A disabled practice file is still synthetic and must never enter production.
  return !!await db.arivePracticeLoan.findFirst({ where: { OR: [{ ariveLoanId: number }, ...(guid ? [{ ariveGuid: guid }] : [])] }, select: { ariveLoanId: true } });
}
export function stableAriveValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableAriveValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableAriveValue((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const ariveRolloutJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Enrolls existing portal rows only. Never creates a Loan, Task, or Arive file. */
export async function enrollAriveRolloutBatch(deps: AriveRolloutDeps = {}, options: { pipelineId?: string } = {}) {
  const db = deps.db || prisma; const now = (deps.now || (() => new Date()))();
  const deadlineMs = deps.deadlineMs ?? Date.now() + 150_000;
  if (!ariveRolloutEnvironmentEnabled()) return { scanned: 0, verified: 0, review: 0, skipped: true };
  const control = await db.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
  if (!control?.collectionEnabled || !control.enrollmentEnabled && !options.pipelineId || !control.enabledById) return { scanned: 0, verified: 0, review: 0, skipped: true };
  await assertAriveRolloutReady(deps);
  const rows = await db.processingPipelineLoan.findMany({
    where: options.pipelineId ? { id: options.pipelineId } : { AND: [ariveRolloutCohortWhere(now), ...(control.enrollmentCursor ? [{ id: { gt: control.enrollmentCursor } }] : [])] },
    include: { loan: { select: rolloutLoanSelect }, ariveSync: true }, orderBy: { id: 'asc' }, take: options.pipelineId ? 1 : ENROLLMENT_BATCH_SIZE,
  });
  let verified = 0; let review = 0; let scanned = 0; let lastScanned: string | null = null;
  for (const row of rows) {
    if (Date.now() > deadlineMs - 75_000) break;
    const priorScanned = lastScanned;
    scanned++; lastScanned = row.id;
    if (row.ariveSync?.workerOwner === 'LEGACY' || row.ariveSync?.operatorPaused || !options.pipelineId && (row.ariveSync?.enrollmentStatus === 'VERIFIED' && row.ariveSync.enabled
      || row.ariveSync?.nextAttemptAt && row.ariveSync.nextAttemptAt > now)) continue;
    if (!options.pipelineId && row.ariveSync?.enrollmentStatus === 'VERIFIED' && control.cohortLimit !== null
      && await db.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true } }) >= control.cohortLimit) continue;
    let enrollmentIssue: string | null = null; let match: ReturnType<typeof verifyAriveRolloutIdentity> | null = null;
    let status = 'REVIEW';
    if (await isArivePracticeFile(db, row.loan.loanNumber)) { status = 'EXCLUDED'; enrollmentIssue = 'This file is registered for isolated practice.'; }
    else if (row.sheet === 'FUNDING' && !row.fundedAt) enrollmentIssue = 'Confirm the existing funding date before enrolling this file in the recent-fundings cohort.';
    else if (!/^\d{1,15}$/.test(row.loan.loanNumber)) enrollmentIssue = 'This portal loan has no confirmed numeric Arive loan number.';
    else {
      try {
        const api = await (deps.session || ariveReadOnlySession)();
        const found = await api(`/loans?searchField=DISPLAY_ID&searchValue=${encodeURIComponent(row.loan.loanNumber)}&limit=100&offset=0`);
        if (!Array.isArray(found.rows) || found.rows.length >= 100
          || found.count !== undefined && (!Number.isSafeInteger(found.count) || found.count !== found.rows.length)) {
          throw new AriveError('The exact-loan search was incomplete or ambiguous. Review this link before enrolling it.');
        }
        const matches = Array.isArray(found.rows) ? (found.rows as unknown[]).map(jsonRecord).filter(r => String(r.ariveLoanId) === row.loan.loanNumber) : [];
        if (matches.length !== 1 || typeof matches[0].sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(matches[0].sysGUID)) throw new AriveError('No unique Arive file matches this existing portal loan number.');
        if (await isArivePracticeFile(db, row.loan.loanNumber, matches[0].sysGUID)) { status = 'EXCLUDED'; enrollmentIssue = 'This file is registered for isolated practice.'; }
        else { match = verifyAriveRolloutIdentity(await api(`/loans/${encodeURIComponent(matches[0].sysGUID)}`), row.loan); status = 'VERIFIED'; }
      } catch (error) {
        // A busy shared transport or exhausted allowance did not verify this
        // candidate. Leave it next in line rather than skipping it until wrap.
        if (error instanceof AriveTransportError) { scanned--; lastScanned = priorScanned; break; }
        enrollmentIssue = error instanceof AriveError ? error.message : 'The Arive link could not be verified. Existing portal values were retained.';
      }
    }
    const saved = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-rollout:company'))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${row.id}`}))`;
      const liveControl = await tx.ariveRolloutControl.findUnique({ where: { id: ARIVE_ROLLOUT_CONNECTION } });
      const current = await tx.processingPipelineLoan.findUnique({ where: { id: row.id }, include: { loan: { select: rolloutLoanSelect }, ariveSync: true } });
      if (!liveControl?.collectionEnabled || !liveControl.enrollmentEnabled && !options.pipelineId || liveControl.generation !== control.generation || !current
        || current.ariveSync?.workerOwner === 'LEGACY' || current.ariveSync?.operatorPaused
        || current.version !== row.version || current.sheet !== row.sheet || stableAriveValue(current.archivedAt) !== stableAriveValue(row.archivedAt)
        || stableAriveValue(current.fundedAt) !== stableAriveValue(row.fundedAt)
        || stableAriveValue(current.ariveSync) !== stableAriveValue(row.ariveSync)
        || stableAriveValue(current.loan) !== stableAriveValue(row.loan)
        || status !== 'EXCLUDED' && await isArivePracticeFile(tx, current.loan.loanNumber, match?.guid)) return false;
      const enabledCount = await tx.arivePipelineSync.count({ where: { workerOwner: ARIVE_ROLLOUT_OWNER, enabled: true } });
      const withinCap = current.ariveSync?.enabled || liveControl.cohortLimit === null || enabledCount < liveControl.cohortLimit;
      const data = { enabled: status === 'VERIFIED' && withinCap, enabledById: control.enabledById!, workerOwner: ARIVE_ROLLOUT_OWNER,
        connectionId: ARIVE_ROLLOUT_CONNECTION, ariveLoanId: current.loan.loanNumber, ariveGuid: match?.guid ?? null,
        enrollmentStatus: status, enrollmentIssue: match && !withinCap ? 'Verified and waiting for the operator cohort limit to increase.' : enrollmentIssue,
        verifiedAt: match ? now : null, verifiedOriginatorEmail: match?.originatorEmail ?? null,
        everFunded: current.ariveSync?.everFunded || current.sheet === 'FUNDING' || current.fundedAt !== null || current.loan.payrollCompRequests.length > 0,
        nextAttemptAt: match ? now : new Date(now.getTime() + ARIVE_QUIET_INTERVAL_MS),
        ...(options.pipelineId && match && withinCap ? { manualRefreshRequestedAt: now } : {}) };
      await tx.arivePipelineSync.upsert({ where: { pipelineId: current.id }, create: { pipelineId: current.id, ...data }, update: data });
      await tx.auditLog.create({ data: { loanId: current.loanId, userId: control.enabledById!, action: 'ARIVE_ROLLOUT_ENROLLMENT', details: JSON.stringify({ pipelineId: current.id, status, issue: enrollmentIssue, connectionId: ARIVE_ROLLOUT_CONNECTION }) } });
      return true;
    });
    if (saved) { if (match) verified++; else review++; }
  }
  if (!options.pipelineId && (lastScanned || rows.length === 0)) await db.ariveRolloutControl.updateMany({ where: { id: ARIVE_ROLLOUT_CONNECTION, generation: control.generation, enrollmentEnabled: true }, data: { enrollmentCursor: scanned < rows.length || rows.length === ENROLLMENT_BATCH_SIZE ? lastScanned : null } });
  return { scanned, verified, review, skipped: false };
}
