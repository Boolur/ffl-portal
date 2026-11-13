import type { ArivePipelineSync, Prisma, ProcessingPipelineLoan } from '@prisma/client';
import { ARIVE_SYNC_PILOT, ariveSyncFieldLabel, type AriveSyncConflict, type AriveSyncIssue, type AriveSyncServiceTracker, type AriveSyncView } from './ariveSyncTypes';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { ariveCanonicalWritesEnabled } from './ariveRolloutFlags';

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
/** Snapshot-level ownership candidate. Mutations must also check the fresh
 * application controls through isAriveManagedForEdit. */
export function isAriveManagedState(state: ArivePipelineSync | null | undefined, loanId: string): boolean {
  if (!state?.enabled) return false;
  if (!state.workerOwner || state.workerOwner === 'LEGACY') return loanId === ARIVE_SYNC_PILOT.loanId;
  return state.workerOwner === 'GENERALIZED' && !state.operatorPaused && state.enrollmentStatus === 'VERIFIED'
    && !!state.verifiedAt && !!state.lastSuccessAt && !!state.ariveGuid
    && Object.keys(jsonRecord(jsonRecord(state.snapshot).managed)).length > 0;
}

/** Read without acquiring a rollout lock: callers may already hold a row lock.
 * The worker independently fences application against the rollout generation. */
export async function generalizedAriveApplicationActive(db: Pick<Prisma.TransactionClient, 'ariveRolloutControl'>): Promise<boolean> {
  if (!ariveCanonicalWritesEnabled()) return false;
  const control = await db.ariveRolloutControl.findUnique({ where: { id: 'company' }, select: { collectionEnabled: true, applicationEnabled: true } });
  return Boolean(control?.collectionEnabled && control.applicationEnabled);
}

export async function isAriveManagedForEdit(db: Pick<Prisma.TransactionClient, 'ariveRolloutControl'>, state: ArivePipelineSync | null | undefined, loanId: string): Promise<boolean> {
  if (!isAriveManagedState(state, loanId)) return false;
  return state?.workerOwner !== 'GENERALIZED' || await generalizedAriveApplicationActive(db);
}

/** Account eligibility and preference are supplied only from a fresh server read. */
export function canViewGeneralizedArive(user: { id: string; active: boolean; role: string; roles: string[]; pilotViewEnabled?: boolean }): boolean {
  return process.env.PILOT_VIEW_ENABLED === 'true' && user.active && user.pilotViewEnabled === true
    && (user.id === ARIVE_SYNC_PILOT.ownerId || [user.role, ...user.roles].some(role => ['ADMIN_I', 'ADMIN_II', 'ADMIN_III'].includes(role)));
}

export function isAriveVisibleForLoan(state: ArivePipelineSync | null | undefined, loan: { id: string; loanNumber: string; loanOfficerId: string }, canViewGeneralized = false): boolean {
  // Pilot participants retain the last verified read-only snapshot after pause.
  // Edit ownership is separately governed by the current application controls.
  if (state?.workerOwner === 'GENERALIZED') return canViewGeneralized && state.enrollmentStatus === 'VERIFIED'
    && !!state.verifiedAt && !!state.lastSuccessAt && !!state.ariveGuid
    && state.ariveLoanId === loan.loanNumber
    && Object.keys(jsonRecord(jsonRecord(state.snapshot).managed)).length > 0;
  return loan.id === ARIVE_SYNC_PILOT.loanId && loan.loanNumber === ARIVE_SYNC_PILOT.loanNumber && loan.loanOfficerId === ARIVE_SYNC_PILOT.ownerId;
}
export function ariveSyncValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}
export function ariveSyncSameValue(field: string, a: unknown, b: unknown) {
  const left = ariveSyncValue(a); const right = ariveSyncValue(b);
  if (left === right) return true;
  // Existing date inputs submit YYYY-MM-DD, while imported dates are stored as ISO.
  if (field.endsWith('At') && left && right && /^\d{4}-\d{2}-\d{2}/.test(left) && /^\d{4}-\d{2}-\d{2}/.test(right)) {
    return /^\d{4}-\d{2}-\d{2}$/.test(left) || /^\d{4}-\d{2}-\d{2}$/.test(right)
      ? left.slice(0, 10) === right.slice(0, 10) : Date.parse(left) === Date.parse(right);
  }
  return false;
}
export function syncConflicts(value: unknown): AriveSyncConflict[] {
  return Array.isArray(value) ? value.filter((c): c is AriveSyncConflict => !!c && typeof c === 'object' && typeof c.field === 'string' && typeof c.label === 'string' && typeof c.detectedAt === 'string' && (c.portalValue === null || typeof c.portalValue === 'string') && (c.ariveValue === null || typeof c.ariveValue === 'string')).slice(-30) : [];
}
export function syncIssues(value: unknown): AriveSyncIssue[] {
  return Array.isArray(value) ? value.filter((i): i is AriveSyncIssue => !!i && typeof i === 'object' && typeof i.field === 'string' && typeof i.code === 'string' && typeof i.message === 'string').slice(0, 100) : [];
}
function serviceTrackerView(value: unknown, issues: AriveSyncIssue[]): AriveSyncServiceTracker[] {
  const trackers = Array.isArray(value) ? value.map(jsonRecord) : [];
  const text = (value: unknown) => typeof value === 'string' && value.trim().length <= 200 ? value.trim() : '';
  return ([['TITLE', 'Title'], ['HOI', 'Homeowners insurance'], ['APPRAISAL', 'Appraisal'], ['PAYOFFS', 'Payoffs']] as const).map(([name, label]) => {
    const matches = trackers.filter(tracker => tracker.name === name);
    const ambiguous = matches.length > 1 || issues.some(issue => issue.field === name && ['AMBIGUOUS_TRACKER_STATUS', 'DUPLICATE_TRACKER'].includes(issue.code));
    const tracker = matches.length === 1 ? matches[0] : null;
    const status = text(tracker?.status);
    if (ambiguous || !status) return {
      name, label, status: '', statusLabel: ambiguous ? 'Multiple current statuses — review Arive' : 'Not supplied by Arive',
      date: null, availability: ambiguous ? 'ambiguous' as const : 'missing' as const,
    };
    // Only the confirmed source status is presented here. Retained portal fields
    // and historical milestones cannot substitute for a missing current status.
    return {
      name, label, status, statusLabel: text(tracker?.statusLabel) || status.replaceAll('_', ' ').toLowerCase().replace(/^./, letter => letter.toUpperCase()),
      date: typeof tracker?.date === 'string' && parseArivePipelineDate(tracker.date) ? tracker.date : null,
      availability: 'current' as const,
    };
  });
}
export function ariveSyncView(state: ArivePipelineSync | null | undefined, eligible: boolean, canManage: boolean, generalizedApplicationEnabled = false): AriveSyncView | null {
  if (!eligible) return null;
  const snapshot = jsonRecord(state?.snapshot); const source = jsonRecord(snapshot.source);
  const issues = syncIssues(state?.issues);
  const structured = jsonRecord(snapshot.structuredValues);
  const sources = jsonRecord(state?.fieldSources);
  const enabled = Boolean(state?.enabled && (state.workerOwner !== 'GENERALIZED' || (!state.operatorPaused && generalizedApplicationEnabled)));
  const labels: Record<string, string> = { pendingItems: 'Pending items', scheduledSigning: 'Scheduled signing', payoffExpiry: 'Payoff expiry', conditionNeeded: 'Conditions needed', hoiExpiration: 'Insurance expiration', completion1004D: '1004D', waterInspection: 'Water inspection', pestInspection: 'Pest inspection' };
  return {
    enabled, lastSuccessAt: state?.lastSuccessAt?.toISOString() || null,
    workerOwner: state?.workerOwner === 'GENERALIZED' ? 'GENERALIZED' : 'LEGACY',
    manualRefreshRequestedAt: state?.manualRefreshRequestedAt?.toISOString() || null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() || null, nextAttemptAt: state?.nextAttemptAt?.toISOString() || null,
    error: state?.lastError || null, stage: typeof source.stage === 'string' ? source.stage : null,
    stageLabel: typeof source.stageLabel === 'string' ? source.stageLabel : null,
    stageDate: typeof source.stageDate === 'string' ? source.stageDate : null,
    conflicts: syncConflicts(state?.conflicts), issues,
    missingFields: [...new Set(issues.filter(i => /MISSING|INVALID|UNAVAILABLE|EMPTY|REMOVED|REGRESSED/.test(i.code)).map(i => i.field))],
    managedFields: enabled ? Object.keys(jsonRecord(snapshot.managed)) : [], canManage,
    serviceTrackers: serviceTrackerView(source.trackers, issues),
    structuredFields: Object.entries(structured).map(([key, value]) => {
      const provenance = jsonRecord(sources[key]);
      return { key, label: labels[key] || key, value: ariveSyncValue(value), author: typeof provenance.author === 'string' ? provenance.author : 'Arive', updatedAt: typeof provenance.effectiveAt === 'string' ? provenance.effectiveAt : null };
    }),
  };
}

/** Saved allowlisted tracker rows; never performs a provider read. */
export function savedAriveTrackers(snapshot: unknown) {
  const rows = jsonRecord(jsonRecord(snapshot).source).trackers;
  const safe = (value: unknown) => typeof value === 'string' && value.length <= 200 ? value : '';
  return (Array.isArray(rows) ? rows : []).slice(0, 100).map(jsonRecord).map(row => ({
    name: safe(row.name), label: safe(row.label) || safe(row.name), status: safe(row.status),
    statusLabel: safe(row.statusLabel) || safe(row.status),
    date: typeof row.date === 'string' && parseArivePipelineDate(row.date) ? row.date : null,
  })).filter(row => row.name);
}

/** Called only after the existing action's row access/version checks. Never makes an Arive write. */
export async function guardArivePipelineEdit(tx: Prisma.TransactionClient, current: ProcessingPipelineLoan, actorId: string, attempted: Record<string, unknown>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${current.id}`}))`;
  const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId: current.id } });
  if (!state || !await isAriveManagedForEdit(tx, state, current.loanId)) return null;
  const managed = { ...jsonRecord(jsonRecord(state.snapshot).managed), archivedAt: current.archivedAt } as Record<string, unknown>;
  const blockedFields = Object.keys(attempted).filter(field => field in managed && !ariveSyncSameValue(field, attempted[field], managed[field]));
  if (!blockedFields.length) return null;
  const now = new Date().toISOString();
  const additions = blockedFields.map(field => ({ field, label: ariveSyncFieldLabel(field), portalValue: ariveSyncValue(attempted[field])?.slice(0, 10000) ?? null, ariveValue: ariveSyncValue(managed[field]), detectedAt: now }));
  await tx.arivePipelineSync.update({ where: { id: state.id }, data: { conflicts: [...syncConflicts(state.conflicts), ...additions].slice(-30) as unknown as Prisma.InputJsonValue } });
  await tx.auditLog.create({ data: { loanId: current.loanId, userId: actorId, action: 'PROCESSING_ARIVE_PORTAL_EDIT_CONFLICT', details: JSON.stringify({ processingPipelineLoanId: current.id, conflicts: additions, outcome: 'ARIVE_VALUES_RETAINED' }) } });
  return { success: false as const, ariveConflict: true as const, blockedFields, error: `This change does not match Arive: ${blockedFields.map(ariveSyncFieldLabel).join(', ')}. Arive’s values were kept. Update these fields in Arive; your attempted change was recorded.` };
}

/** Prevent legacy derived defaults from changing imported dates/statuses during unrelated edits. */
export async function preserveAriveManagedFields(tx: Prisma.TransactionClient, current: ProcessingPipelineLoan, data: Prisma.ProcessingPipelineLoanUpdateManyMutationInput) {
  const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId: current.id } });
  if (!state || !await isAriveManagedForEdit(tx, state, current.loanId)) return;
  const managed = jsonRecord(jsonRecord(state.snapshot).managed);
  for (const field of [...Object.keys(managed), 'firstPaymentAt', 'sixthPaymentAt', 'rateLockRequestedAt', 'rateLockRequestedById']) {
    if (field in current) (data as Record<string, unknown>)[field] = (current as unknown as Record<string, unknown>)[field];
  }
}
