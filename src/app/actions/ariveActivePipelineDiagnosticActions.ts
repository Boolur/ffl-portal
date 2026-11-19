'use server';

import { createHash, randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { Prisma, UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdminIII } from '@/lib/adminTiers';
import { AriveError } from '@/lib/ariveClient';
import { AriveTransportError } from '@/lib/ariveTransport';
import { isAriveBudgetReady } from '@/lib/ariveTransportPrisma';
import { stableAriveValue } from '@/lib/ariveRollout';
import { ARIVE_SYNC_PILOT } from '@/lib/ariveSyncTypes';
import { runAriveActivePipelineDiagnosticChunk, type AriveActiveDiagnosticLoan, type AriveActiveDiagnosticResult } from '@/lib/ariveActivePipelineDiagnostic';
import type { ActiveDiagnosticEvidence, ActiveDiagnosticObservedIdentity, ActivePipelineDiagnosticResponse, ActivePipelineDiagnosticRun, ActivePipelineDiagnosticRow } from '@/lib/ariveActivePipelineDiagnosticTypes';
import {diagnosticSourceSelect as select,type DiagnosticSource as Source} from '../../lib/ariveDiagnosticSource';

const ACTION = 'ARIVE_ACTIVE_PIPELINE_DIAGNOSTIC';
const CONNECTION = 'company';
const MAX_COHORT = 1000;
const CHUNK_SIZE = 5;
const GET_RESERVATION = 16;
const AUTH_RESERVATION = 2;
const LEASE_MS = 180_000;
const RUN_TTL_MS = 6 * 60 * 60_000;
const terminal = new Set(['COMPLETE', 'CANCELLED', 'INVALIDATED']);
const activeWhere = { sheet: 'PIPELINE', archivedAt: null } as const;
type CohortRow = { pipelineId: string; loanId: string; loanNumber: string; version: number; sourceHash: string; duplicateNumericId: boolean; practice: boolean; synthetic: boolean; inactive?: boolean };
type ActiveDiagnosticResult = Omit<ActivePipelineDiagnosticRow, 'borrowerName' | 'loanOfficer' | 'synthetic'>;
type Stored = {
  schema: 1; status: ActivePipelineDiagnosticRun['status']; startedAt: string; finishedAt: string | null;
  generation: number; credentialRevision: string; credentialHash: string;
  cohort: CohortRow[]; results: ActiveDiagnosticResult[]; cursor: number;
  getRequests: number; authenticationRequests: number; reservedGets: number; reservedAuth: number;
  leaseToken: string | null; leaseUntil: string | null; leaseActorId: string | null;
  retryAt: string | null; message: string | null;
  lineage?: { parentRunId: string; rootRunId: string; baselineCohort: CohortRow[]; carriedMatchedPipelineIds: string[] };
};
type Db = Pick<typeof prisma, 'ariveRolloutControl' | 'ariveIntegrationConfig' | 'arivePipelineSync' | 'auditLog'>;
const digest = (value: unknown) => createHash('sha256').update(stableAriveValue(value)).digest('hex');
const hashSource = (row: Source) => digest(row);
const failure = (error: unknown): ActivePipelineDiagnosticResponse => ({ success: false, error: error instanceof AriveError || error instanceof AriveTransportError ? error.message : 'The read-only diagnostic could not finish. Saved progress is retained.' });
const validId = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new AriveError('Choose an existing diagnostic run.');
  return value;
};

/** Keep only the small identity comparison contract, even if a caller supplies extra fields. */
function evidenceProjection(value: unknown): ActiveDiagnosticEvidence | undefined {
  if (value === undefined) return undefined;
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid evidence');
    return v as Record<string, unknown>;
  };
  const text = (v: unknown, max = 300): string | null => {
    if (v === null) return null;
    if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error('Invalid evidence');
    return v;
  };
  const strings = (v: unknown, maximum: number, length = 300): string[] => {
    if (!Array.isArray(v) || v.length > maximum) throw new Error('Invalid evidence');
    return v.map(item => { const checked = text(item, length); if (checked === null) throw new Error('Invalid evidence'); return checked; });
  };
  const http = (v: unknown) => { if (v !== null && (!Number.isInteger(v) || Number(v) < 100 || Number(v) > 599)) throw new Error('Invalid evidence'); return v as number | null; };
  const observed = (v: unknown): ActiveDiagnosticObservedIdentity => {
    const r = record(v);
    const identity: ActiveDiagnosticObservedIdentity = { loanNumber: text(r.loanNumber), guid: text(r.guid, 100), originatorEmail: text(r.originatorEmail, 254), borrowers: strings(r.borrowers, 10), issues: strings(r.issues, 8, 80) };
    if (r.team !== undefined) {
      if (!Array.isArray(r.team) || r.team.length > 20) throw new Error('Invalid evidence');
      identity.team = r.team.map(item => { const member = record(item); if (member.primary !== null && typeof member.primary !== 'boolean') throw new Error('Invalid evidence'); return { email: text(member.email, 254), role: text(member.role, 100), primary: member.primary as boolean | null }; });
    }
    if (r.otherApplicants !== undefined) {
      if (!Array.isArray(r.otherApplicants) || r.otherApplicants.length > 8) throw new Error('Invalid evidence');
      identity.otherApplicants = r.otherApplicants.map(item => { const applicant = record(item); return { name: text(applicant.name), applicantType: text(applicant.applicantType, 100) }; });
    }
    if (r.teamEvidenceSource !== undefined) {
      if (r.teamEvidenceSource !== 'DETAIL') throw new Error('Invalid evidence');
      identity.teamEvidenceSource = 'DETAIL';
    }
    return identity;
  };
  const v = record(value); const p = record(v.portal); const loanNumber = text(p.loanNumber);
  if (loanNumber === null) throw new Error('Invalid evidence');
  const out: ActiveDiagnosticEvidence = { portal: { loanNumber, savedGuid: text(p.savedGuid, 100), primaryOriginatorEmail: text(p.primaryOriginatorEmail, 254), secondaryOriginatorEmail: text(p.secondaryOriginatorEmail, 254), savedOriginatorEmail: text(p.savedOriginatorEmail, 254), borrowerName: text(p.borrowerName) } };
  if (v.search !== undefined) out.search = observed(v.search);
  if (v.detail !== undefined) out.detail = observed(v.detail);
  if (v.numericProbe !== undefined) {
    const n = record(v.numericProbe); out.numericProbe = { httpStatus: http(n.httpStatus), requestId: text(n.requestId, 100), ...(n.identity === undefined ? {} : { identity: observed(n.identity) }) };
  }
  if (v.borrowerSearch !== undefined) {
    const b = record(v.borrowerSearch);
    if (b.count !== null && (!Number.isSafeInteger(b.count) || Number(b.count) < 0) || typeof b.complete !== 'boolean' || typeof b.candidatesTruncated !== 'boolean' || !Array.isArray(b.candidates) || b.candidates.length > 10) throw new Error('Invalid evidence');
    out.borrowerSearch = { httpStatus: http(b.httpStatus), requestId: text(b.requestId, 100), count: b.count as number | null, complete: b.complete, candidatesTruncated: b.candidatesTruncated, candidates: b.candidates.map(observed) };
  }
  return out;
}

async function admin(expectedId?: string) {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  if (!session?.user?.id || !role || !isAdminIII(role) || expectedId && session.user.id !== expectedId) throw new AriveError('Sign in with your current Admin III account to use this diagnostic.');
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, active: true, role: true, roles: true } });
  if (!user?.active || ![user.role, ...user.roles].includes(role)) throw new AriveError('Your current account cannot use this diagnostic.');
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') throw new AriveError('This diagnostic is disabled on preview deployments.');
  return user;
}
function decode(details: string | null): Stored {
  let value: Stored;
  try { if (!details || details.length > 3_000_000) throw new Error(); value = JSON.parse(details); } catch { throw new AriveError('The saved diagnostic is invalid. Start a new run.'); }
  const integer = (n: unknown, max = 10_000) => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= max;
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v));
  const identifier = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(v);
  const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  const cohortRow = (row: CohortRow) => !!row && identifier(row.pipelineId) && identifier(row.loanId) && integer(row.version, 2_000_000_000)
    && hash(row.sourceHash) && typeof row.loanNumber === 'string' && row.loanNumber.length <= 300
    && [row.duplicateNumericId, row.practice, row.synthetic].every(v => typeof v === 'boolean') && (row.inactive === undefined || typeof row.inactive === 'boolean');
  const outcomes = new Set(['MATCHED', 'INVALID_LOAN_NUMBER', 'DUPLICATE_PORTAL_NUMBER', 'PRACTICE_EXCLUDED', 'SOURCE_CHANGED', 'NO_API_MATCH', 'AMBIGUOUS_API_MATCH', 'INVALID_RESPONSE', 'IDENTITY_MISMATCH', 'HTTP_ERROR']);
  if (!value || value.schema !== 1 || !Array.isArray(value.cohort) || value.cohort.length > MAX_COHORT
    || !Array.isArray(value.results) || !integer(value.cursor, MAX_COHORT) || value.cursor !== value.results.length || value.cursor > value.cohort.length
    || !['READY', 'RUNNING', 'DEFERRED', 'COMPLETE', 'CANCELLED', 'INVALIDATED'].includes(value.status)
    || !date(value.startedAt) || value.finishedAt !== null && !date(value.finishedAt) || !date(value.credentialRevision)
    || !integer(value.generation, 2_000_000_000) || !hash(value.credentialHash)
    || ![value.getRequests, value.authenticationRequests, value.reservedGets, value.reservedAuth].every(n => integer(n))
    || value.reservedGets < value.getRequests || value.reservedAuth < value.authenticationRequests
    || value.retryAt !== null && !date(value.retryAt) || value.leaseUntil !== null && !date(value.leaseUntil)
    || value.leaseToken !== null && !identifier(value.leaseToken) || value.leaseActorId !== null && !identifier(value.leaseActorId)
    || value.status === 'RUNNING' && (!value.leaseToken || !value.leaseUntil || !value.leaseActorId)
    || value.status === 'COMPLETE' && value.cursor !== value.cohort.length
    || new Set(value.cohort.map(row => row?.pipelineId)).size !== value.cohort.length
    || value.cohort.some(row => !cohortRow(row))
    || value.lineage !== undefined && (!value.lineage || !identifier(value.lineage.parentRunId) || !identifier(value.lineage.rootRunId)
      || !Array.isArray(value.lineage.baselineCohort) || value.lineage.baselineCohort.length > MAX_COHORT || value.lineage.baselineCohort.some(row => !cohortRow(row))
      || new Set(value.lineage.baselineCohort.map(row => row.pipelineId)).size !== value.lineage.baselineCohort.length
      || !Array.isArray(value.lineage.carriedMatchedPipelineIds) || value.lineage.carriedMatchedPipelineIds.length > MAX_COHORT
      || new Set(value.lineage.carriedMatchedPipelineIds).size !== value.lineage.carriedMatchedPipelineIds.length
      || value.lineage.carriedMatchedPipelineIds.some(id => !identifier(id) || value.cohort.some(row => row.pipelineId === id) || !value.lineage!.baselineCohort.some(row => row.pipelineId === id))
      || value.cohort.some(row => !value.lineage!.baselineCohort.some(base => base.pipelineId === row.pipelineId && base.sourceHash === row.sourceHash)))
    || value.results.some((row, index) => !row || row.pipelineId !== value.cohort[index]?.pipelineId || row.loanNumber !== value.cohort[index]?.loanNumber
      || !outcomes.has(row.outcome) || !date(row.checkedAt) || typeof row.message !== 'string' || row.message.length > 1000)) throw new AriveError('The saved diagnostic is invalid.');
  try { value.results = value.results.map(row => ({ ...row, evidence: evidenceProjection(row.evidence) })); }
  catch { throw new AriveError('The saved diagnostic identity evidence is invalid.'); }
  return value;
}
async function environment(db: Db = prisma) {
  const [control, connection, running] = await Promise.all([
    db.ariveRolloutControl.findUnique({ where: { id: CONNECTION }, select: { collectionEnabled: true, applicationEnabled: true, enrollmentEnabled: true, generation: true } }),
    db.ariveIntegrationConfig.findUnique({ where: { id: CONNECTION }, select: { encryptedCredentials: true, updatedAt: true } }),
    db.arivePipelineSync.count({ where: { OR: [{ enabled: true }, { leaseUntil: { gt: new Date() } }] } }),
  ]);
  const paused = !!control && !control.collectionEnabled && !control.applicationEnabled && !control.enrollmentEnabled && running === 0;
  return { paused, generation: control?.generation ?? -1, credentialRevision: connection?.updatedAt.toISOString() ?? '', credentialHash: connection ? digest(connection.encryptedCredentials) : '' };
}
function checkEnvironment(current: Awaited<ReturnType<typeof environment>>, state?: Stored) {
  if (!current.paused) throw new AriveTransportError('DIAGNOSTIC_INVALIDATED', 'Automatic synchronization must remain fully paused. No loan updates were made by this diagnostic.');
  if (!current.credentialRevision) throw new AriveTransportError('DIAGNOSTIC_INVALIDATED', 'Save the branch connection before starting this diagnostic.');
  if (state && (current.generation !== state.generation || current.credentialRevision !== state.credentialRevision || current.credentialHash !== state.credentialHash)) throw new AriveTransportError('DIAGNOSTIC_INVALIDATED', 'The connection or synchronization controls changed. Start a new diagnostic using the current settings.');
  if (state && Date.now() > Date.parse(state.startedAt) + RUN_TTL_MS) throw new AriveTransportError('DIAGNOSTIC_INVALIDATED', 'This diagnostic has expired. Start a new run for the current pipeline.');
}
async function save(db: Pick<typeof prisma, 'auditLog'>, runId: string, state: Stored) {
  await db.auditLog.update({ where: { id: runId }, data: { details: JSON.stringify(state) } });
}
async function findRun(db: Pick<typeof prisma, 'auditLog'>, runId: string) {
  const row = await db.auditLog.findUnique({ where: { id: runId }, select: { id: true, action: true, details: true } });
  if (!row || row.action !== ACTION) throw new AriveError('The diagnostic run was not found.');
  return { id: row.id, state: decode(row.details) };
}
async function locked<T>(work: (db: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-active-pipeline-diagnostic:company'))`;
    return work(tx);
  }, { maxWait: 10_000, timeout: 20_000 });
}
function sourceChanged(row: CohortRow): ActiveDiagnosticResult {
  return { pipelineId: row.pipelineId, loanNumber: row.loanNumber, outcome: 'SOURCE_CHANGED', message: row.inactive ? 'This file is no longer in the active pipeline. No Arive reads were made for it in this follow-up.' : 'The portal file changed after this run started. Check its current identity in a new run.', checkedAt: new Date().toISOString(), searchHttpStatus: null, detailHttpStatus: null, requestId: null };
}
function displayResult(row: AriveActiveDiagnosticResult): ActiveDiagnosticResult {
  const messages: Record<AriveActiveDiagnosticResult['status'], string> = {
    VERIFIED: 'Arive search and file details passed the loan number, permanent ID, borrower, and originator checks.',
    INVALID_LOAN_NUMBER: 'The portal loan number is not a valid numeric Arive loan number.',
    DUPLICATE_PORTAL_NUMBER: 'More than one portal pipeline record uses this loan number. Review the duplicate before linking.',
    PRACTICE_EXCLUDED: 'Registered practice file; excluded from real-loan access checks.',
    SOURCE_CHANGED: 'The portal identity changed during this diagnostic. Check it again in a new run.',
    NO_API_MATCH: 'No exact loan was visible through this API connection. This does not establish that the loan was deleted.',
    AMBIGUOUS_API_MATCH: 'Arive returned multiple exact matches. The link cannot be accepted automatically.',
    INVALID_RESPONSE: 'Arive returned an incomplete or invalid identity response.',
    IDENTITY_MISMATCH: row.identityIssue === 'ORIGINATOR' ? 'The loan is accessible, but its Arive originator does not match the verified portal loan officer.'
      : row.identityIssue === 'BORROWER_NAME' ? 'The loan is accessible, but its borrower name does not exactly match the portal.'
        : row.identityIssue === 'LOAN_NUMBER_OR_GUID' ? 'The Arive loan number or permanent file ID does not match the existing portal link.' : 'The loan is accessible, but its identity could not be verified.',
    HTTP_ERROR: `Arive returned HTTP ${row.httpStatus ?? 'error'} during the ${row.phase.toLowerCase()} check.${row.gatewayCode ? ` Gateway: ${row.gatewayCode}.` : ''}`,
  };
  return { pipelineId: row.pipelineId, loanNumber: row.loanNumber, outcome: row.status === 'VERIFIED' ? 'MATCHED' : row.status,
    message: messages[row.status], checkedAt: row.checkedAt,
    searchHttpStatus: row.phase === 'SEARCH' ? row.httpStatus : row.phase === 'DETAIL' ? 200 : null,
    detailHttpStatus: row.phase === 'DETAIL' ? row.httpStatus : null, requestId: typeof row.requestId === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(row.requestId) ? row.requestId : null,
    evidence: evidenceProjection(row.evidence) };
}
async function project(runId: string, state: Stored): Promise<ActivePipelineDiagnosticRun> {
  const [sources, active, env] = await Promise.all([
    prisma.processingPipelineLoan.findMany({ where: { id: { in: state.cohort.map(row => row.pipelineId) } }, select }),
    prisma.processingPipelineLoan.findMany({ where: activeWhere, select: { id: true } }), environment(),
  ]);
  const byId = new Map(sources.map(row => [row.id, row]));
  const membership = new Set((state.lineage?.baselineCohort || state.cohort).map(row => row.pipelineId));
  const results = new Map(state.results.map(row => [row.pipelineId, row]));
  let changedSinceStart = 0;
  const rows = state.cohort.map(row => {
    const source = byId.get(row.pipelineId);
    const changed = row.inactive === true || !source || hashSource(source) !== row.sourceHash;
    if (changed) changedSinceStart++;
    const result = results.get(row.pipelineId);
    const displayResult = result && changed ? sourceChanged(row) : result;
    return { pipelineId: row.pipelineId, loanNumber: row.loanNumber, borrowerName: source?.loan.borrowerName || 'File no longer available',
      loanOfficer: source?.loan.loanOfficer.name || 'Not provided', synthetic: row.synthetic || row.practice,
      outcome: displayResult?.outcome || 'PENDING', message: displayResult?.message || 'Not checked yet.', checkedAt: displayResult?.checkedAt || null,
      searchHttpStatus: displayResult?.searchHttpStatus ?? null, detailHttpStatus: displayResult?.detailHttpStatus ?? null, requestId: displayResult?.requestId ?? null,
      evidence: displayResult?.evidence };
  });
  const matched = rows.filter(row => row.outcome === 'MATCHED');
  const leaseExpired = state.status === 'RUNNING' && state.leaseUntil && Date.parse(state.leaseUntil) <= Date.now();
  return { id: runId, status: leaseExpired ? 'READY' : state.status, startedAt: state.startedAt, finishedAt: state.finishedAt,
    total: rows.length, checked: state.cursor, matched: matched.length, needsReview: state.cursor - matched.length,
    realTotal: rows.filter(row => !row.synthetic).length, syntheticTotal: rows.filter(row => row.synthetic).length,
    realMatched: matched.filter(row => !row.synthetic).length, syntheticMatched: matched.filter(row => row.synthetic).length,
    getRequests: state.getRequests, authenticationRequests: state.authenticationRequests, retryAt: state.status === 'RUNNING' && !leaseExpired ? state.leaseUntil : state.retryAt,
    message: state.message, automaticSyncPaused: env.paused, currentActiveCount: active.length,
    addedSinceStart: active.filter(row => !membership.has(row.id)).length, changedSinceStart, rows,
    scope: state.lineage ? 'FOLLOW_UP' : 'FULL', parentRunId: state.lineage?.parentRunId, rootRunId: state.lineage?.rootRunId,
    baselineTotal: membership.size };
}

/** Database-only: opening the screen never starts Arive reads. */
export async function getActivePipelineDiagnostic(): Promise<ActivePipelineDiagnosticResponse> {
  try {
    await admin();
    const row = await prisma.auditLog.findFirst({ where: { action: ACTION }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, details: true } });
    return { success: true, run: row ? await project(row.id, decode(row.details)) : null };
  } catch (error) { return failure(error); }
}

/** Snapshot identities only. Never enrolls or queues a live loan. */
async function startDiagnostic(followUpRunId?: string): Promise<ActivePipelineDiagnosticResponse> {
  try {
    const actor = await admin();
    const budget = await isAriveBudgetReady({ allowCooldown: true });
    if (!budget.ready) throw new AriveError(budget.reason || 'Shared request controls must be ready before starting.');
    const run = await locked(async db => {
      const env = await environment(db); checkEnvironment(env);
      const prior = await db.auditLog.findFirst({ where: { action: ACTION }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true, details: true } });
      let parent: { id: string; state: Stored } | null = null;
      if (prior) {
        const state = decode(prior.details);
        if (followUpRunId && prior.id !== followUpRunId) {
          if (state.lineage?.parentRunId === followUpRunId && !terminal.has(state.status)) { checkEnvironment(env, state); return { id: prior.id, state }; }
          throw new AriveError('Refresh the latest diagnostic before starting its follow-up. The selected run has been superseded.');
        }
        if (followUpRunId) {
          if (!terminal.has(state.status)) throw new AriveError('Finish or end the current diagnostic before starting its follow-up.');
          if (env.generation !== state.generation || env.credentialRevision !== state.credentialRevision || env.credentialHash !== state.credentialHash) throw new AriveError('The connection or synchronization controls changed. Start a full diagnostic before carrying earlier matches forward.');
          parent = { id: prior.id, state };
        }
        if (!terminal.has(state.status) && Date.now() <= Date.parse(state.startedAt) + RUN_TTL_MS) {
          try { checkEnvironment(env, state); return { id: prior.id, state }; }
          catch { state.status = 'INVALIDATED'; state.finishedAt = new Date().toISOString(); state.leaseToken = null; state.leaseUntil = null; state.message = 'The connection or synchronization controls changed.'; await save(db, prior.id, state); }
        }
        if (Date.now() < Date.parse(state.startedAt) + 5 * 60_000) throw new AriveError('Wait five minutes between new diagnostic runs. Resume an existing run to continue its saved progress.');
      }
      if (followUpRunId && !parent) throw new AriveError('The diagnostic run was not found.');
      const [activeSources, practice] = await Promise.all([
        db.processingPipelineLoan.findMany({ where: activeWhere, select, orderBy: { id: 'asc' }, take: MAX_COHORT + 1 }),
        db.arivePracticeLoan.findMany({ select: { ariveLoanId: true, ariveGuid: true } }),
      ]);
      if (activeSources.length > MAX_COHORT) throw new AriveError('The active pipeline exceeds this diagnostic’s 1,000-file limit. No partial run was started.');
      const baseline = parent ? parent.state.lineage?.baselineCohort || parent.state.cohort : [];
      const baselineById = new Map(baseline.map(row => [row.pipelineId, row]));
      const priorMatched = new Set(parent ? [...(parent.state.lineage?.carriedMatchedPipelineIds || []), ...parent.state.results.filter(row => row.outcome === 'MATCHED').map(row => row.pipelineId)] : []);
      const priorSources = parent ? await db.processingPipelineLoan.findMany({ where: { id: { in: baseline.map(row => row.pipelineId) } }, select }) : [];
      const currentById = new Map([...priorSources, ...activeSources].map(row => [row.id, row]));
      const activeIds = new Set(activeSources.map(row => row.id));
      const selectedIds = new Set(parent ? [
        ...activeSources.filter(row => !priorMatched.has(row.id) || !baselineById.has(row.id) || hashSource(row) !== baselineById.get(row.id)!.sourceHash).map(row => row.id),
        ...baseline.filter(row => !activeIds.has(row.pipelineId) && (!priorMatched.has(row.pipelineId) || !currentById.has(row.pipelineId) || hashSource(currentById.get(row.pipelineId)!) !== row.sourceHash)).map(row => row.pipelineId),
      ] : activeSources.map(row => row.id));
      const sources = [...selectedIds].map(id => currentById.get(id)).filter((row): row is Source => !!row);
      const numbers = sources.map(row => row.loan.loanNumber);
      const existing = await db.processingPipelineLoan.findMany({ where: { loan: { loanNumber: { in: numbers } } }, select: { loan: { select: { loanNumber: true } } } });
      const counts = new Map<string, number>();
      for (const row of existing) counts.set(row.loan.loanNumber, (counts.get(row.loan.loanNumber) || 0) + 1);
      const cohort: CohortRow[] = [...selectedIds].sort().map(id => {
        const row = currentById.get(id);
        if (!row) return { ...baselineById.get(id)!, inactive: true };
        return { pipelineId: row.id, loanId: row.loanId, loanNumber: row.loan.loanNumber, version: row.version, sourceHash: hashSource(row),
          duplicateNumericId: (counts.get(row.loan.loanNumber) || 0) > 1,
          practice: practice.some(file => file.ariveLoanId === row.loan.loanNumber || file.ariveGuid && file.ariveGuid === row.ariveSync?.ariveGuid),
          synthetic: row.loanId === ARIVE_SYNC_PILOT.loanId && row.loan.loanNumber === ARIVE_SYNC_PILOT.loanNumber,
          ...(activeIds.has(row.id) ? {} : { inactive: true }) };
      });
      const combinedBaseline = new Map(baseline.map(row => [row.pipelineId, row]));
      for (const row of cohort) combinedBaseline.set(row.pipelineId, row);
      if (cohort.length > MAX_COHORT || combinedBaseline.size > MAX_COHORT) throw new AriveError('This diagnostic exceeds the 1,000-file limit. No partial run was started.');
      const state: Stored = { schema: 1, status: cohort.length ? 'READY' : 'COMPLETE', startedAt: new Date().toISOString(), finishedAt: cohort.length ? null : new Date().toISOString(),
        generation: env.generation, credentialRevision: env.credentialRevision, credentialHash: env.credentialHash,
        cohort,
        results: [], cursor: 0, getRequests: 0, authenticationRequests: 0, reservedGets: 0, reservedAuth: 0,
        leaseToken: null, leaseUntil: null, leaseActorId: null, retryAt: null, message: parent && !cohort.length ? 'No review items, changed identities, or new active loans need another check.' : null,
        ...(parent ? { lineage: { parentRunId: parent.id, rootRunId: parent.state.lineage?.rootRunId || parent.id,
          baselineCohort: [...combinedBaseline.values()], carriedMatchedPipelineIds: [...priorMatched].filter(id => !selectedIds.has(id)) } } : {}) };
      const row = await db.auditLog.create({ data: { userId: actor.id, action: ACTION, details: JSON.stringify(state) }, select: { id: true } });
      return { id: row.id, state };
    });
    return { success: true, run: await project(run.id, run.state) };
  } catch (error) { return failure(error); }
}

export async function startActivePipelineDiagnostic(): Promise<ActivePipelineDiagnosticResponse> {
  return startDiagnostic();
}

/** Server selects review/changed/new files; a client cannot submit arbitrary loan identities. */
export async function startActivePipelineDiagnosticFollowUp(input: { runId: string }): Promise<ActivePipelineDiagnosticResponse> {
  try { await admin(); return await startDiagnostic(validId(input?.runId)); } catch (error) { return failure(error); }
}

/** A bounded chunk; only diagnostic progress and shared request metadata are written. */
export async function continueActivePipelineDiagnostic(input: { runId: string }): Promise<ActivePipelineDiagnosticResponse> {
  let claimed: { id: string; state: Stored; token: string } | null = null;
  try {
    const actor = await admin(); const runId = validId(input?.runId);
    const claim = await locked(async db => {
      const run = await findRun(db, runId); const state = run.state;
      if (terminal.has(state.status)) return { ...run, token: null };
      checkEnvironment(await environment(db), state);
      if (state.leaseUntil && Date.parse(state.leaseUntil) > Date.now()) return { ...run, token: null };
      if (state.retryAt && Date.parse(state.retryAt) > Date.now()) return { ...run, token: null };
      // A timed-out lease retains its reservation, so crashes cannot reset the run budget.
      if (state.reservedGets + GET_RESERVATION > Math.max(32, state.cohort.length * 4 + 20) || state.reservedAuth + AUTH_RESERVATION > 20) {
        state.status = 'INVALIDATED'; state.finishedAt = new Date().toISOString(); state.message = 'The diagnostic reached its bounded request allowance. Review the saved results before starting another run.';
        await save(db, runId, state); return { ...run, token: null };
      }
      const token = randomUUID(); state.leaseToken = token; state.leaseUntil = new Date(Date.now() + LEASE_MS).toISOString(); state.leaseActorId = actor.id;
      state.status = 'RUNNING'; state.retryAt = null; state.message = null; state.reservedGets += GET_RESERVATION; state.reservedAuth += AUTH_RESERVATION;
      await save(db, runId, state); return { ...run, token };
    });
    if (!claim.token) return { success: true, run: await project(claim.id, claim.state) };
    claimed = { ...claim, token: claim.token };
    const fixed = claim.state.cohort.slice(claim.state.cursor, claim.state.cursor + CHUNK_SIZE);
    const current = await prisma.processingPipelineLoan.findMany({ where: { id: { in: fixed.map(row => row.pipelineId) } }, select });
    const byId = new Map(current.map(row => [row.id, row]));
    const changed = new Set(fixed.filter(row => row.inactive || !byId.has(row.pipelineId) || hashSource(byId.get(row.pipelineId)!) !== row.sourceHash).map(row => row.pipelineId));
    // Changed records become explicit outcomes; reads use only unchanged, server-loaded identities.
    const loans: AriveActiveDiagnosticLoan[] = fixed.filter(row => !changed.has(row.pipelineId)).map(row => {
      const source = byId.get(row.pipelineId)!;
      return { ...source.loan, pipelineId: source.id, version: source.version,
        savedGuid: source.ariveSync?.ariveGuid ?? null, savedOriginatorEmail: source.ariveSync?.verifiedOriginatorEmail ?? null,
        duplicateNumericId: row.duplicateNumericId, practice: row.practice, synthetic: row.synthetic };
    });
    const guard = async () => {
      // These independent database checks all finish before any HTTP send.
      // Running them together avoids adding serial round trips to every read.
      const [, env, run] = await Promise.all([admin(actor.id), environment(), findRun(prisma, runId)]);
      checkEnvironment(env, claim.state);
      if (run.state.status !== 'RUNNING' || run.state.leaseToken !== claim.token || !run.state.leaseUntil || Date.parse(run.state.leaseUntil) <= Date.now()) throw new AriveTransportError('DIAGNOSTIC_INVALIDATED', 'The diagnostic was stopped or its execution lease expired.');
    };
    const result = await runAriveActivePipelineDiagnosticChunk({ loans, credentialRevision: claim.state.credentialRevision, guard, deadlineMs: Date.now() + 120_000, investigate: !!claim.state.lineage });
    await admin(actor.id);
    const saved = await locked(async db => {
      const run = await findRun(db, runId); const state = run.state;
      if (state.leaseToken !== claim.token || state.status !== 'RUNNING') return run;
      if (!state.leaseUntil || Date.parse(state.leaseUntil) <= Date.now()) {
        state.status = 'INVALIDATED'; state.finishedAt = new Date().toISOString(); state.leaseToken = null; state.leaseUntil = null; state.leaseActorId = null;
        state.message = 'The execution lease expired before results could be accepted. The batch allowance remains reserved.';
        await save(db, runId, state); return run;
      }
      const after = await db.processingPipelineLoan.findMany({ where: { id: { in: fixed.map(row => row.pipelineId) } }, select });
      const afterById = new Map(after.map(row => [row.id, row]));
      const completed = new Map(result.results.map(row => [row.pipelineId, displayResult(row)]));
      let invalidated = result.invalidated;
      try { checkEnvironment(await environment(db), state); } catch { invalidated = true; }
      // A connection/control change after the last HTTP response cannot certify
      // any new row. Charge the requests but retain only earlier checkpoints.
      for (const row of invalidated ? [] : fixed) {
        if (changed.has(row.pipelineId) || !afterById.has(row.pipelineId) || hashSource(afterById.get(row.pipelineId)!) !== row.sourceHash) state.results.push(sourceChanged(row));
        else if (completed.has(row.pipelineId)) state.results.push(completed.get(row.pipelineId)!);
        else break; // Preserve the fixed order when shared limits defer the next loan.
      }
      state.cursor = state.results.length; state.getRequests += result.getRequests; state.authenticationRequests += result.authenticationRequests;
      state.reservedGets -= GET_RESERVATION - result.getRequests; state.reservedAuth -= AUTH_RESERVATION - result.authenticationRequests;
      state.leaseToken = null; state.leaseUntil = null; state.leaseActorId = null;
      state.status = invalidated ? 'INVALIDATED' : state.cursor === state.cohort.length ? 'COMPLETE' : result.deferred ? 'DEFERRED' : 'READY';
      state.retryAt = result.deferred?.retryAt ?? null;
      state.message = invalidated ? 'The connection, account, or synchronization controls changed. Review saved results and start a new diagnostic.' : result.deferred ? `The shared request controls deferred this batch (${result.deferred.code}). Resume after the retry time.` : state.status === 'COMPLETE' ? state.lineage ? 'Every file selected for this follow-up has a recorded outcome. Earlier stable matches were not re-read. No workflow updates were applied.' : 'Every file in the starting active pipeline has a recorded outcome. No workflow updates were applied.' : null;
      if (terminal.has(state.status)) state.finishedAt = new Date().toISOString();
      await save(db, runId, state); return run;
    });
    return { success: true, run: await project(saved.id, saved.state) };
  } catch (error) {
    // Preserve conservative reservations on unexpected failure. No invisible replays.
    if (claimed) {
      const { id: runId, token } = claimed;
      await locked(async db => {
        const run = await findRun(db, runId);
        if (run.state.leaseToken === token && run.state.status === 'RUNNING') {
          run.state.status = 'INVALIDATED'; run.state.finishedAt = new Date().toISOString(); run.state.leaseToken = null; run.state.leaseUntil = null; run.state.leaseActorId = null;
          run.state.message = 'This batch stopped safely. Its request allowance remains reserved; review results before starting a new run.';
          await save(db, runId, run.state);
        }
      }).catch(() => undefined);
    }
    return failure(error);
  }
}

export async function cancelActivePipelineDiagnostic(input: { runId: string }): Promise<ActivePipelineDiagnosticResponse> {
  try {
    await admin(); const runId = validId(input?.runId);
    const run = await locked(async db => {
      const run = await findRun(db, runId);
      if (!terminal.has(run.state.status)) {
        run.state.status = 'CANCELLED'; run.state.finishedAt = new Date().toISOString(); run.state.leaseToken = null; run.state.leaseUntil = null; run.state.leaseActorId = null;
        run.state.message = 'Diagnostic stopped. No workflow updates were applied.'; await save(db, runId, run.state);
      }
      return run;
    });
    return { success: true, run: await project(run.id, run.state) };
  } catch (error) { return failure(error); }
}
