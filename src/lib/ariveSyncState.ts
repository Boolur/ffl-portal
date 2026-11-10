import type { ArivePipelineSync, Prisma, ProcessingPipelineLoan } from '@prisma/client';
import { ARIVE_SYNC_PILOT, ariveSyncFieldLabel, type AriveSyncConflict, type AriveSyncIssue, type AriveSyncServiceTracker, type AriveSyncView } from './ariveSyncTypes';
import { parseArivePipelineDate } from './arivePipelineMapping';

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
export function ariveSyncView(state: ArivePipelineSync | null | undefined, eligible: boolean, canManage: boolean): AriveSyncView | null {
  if (!eligible) return null;
  const snapshot = jsonRecord(state?.snapshot); const source = jsonRecord(snapshot.source);
  const issues = syncIssues(state?.issues);
  const structured = jsonRecord(snapshot.structuredValues);
  const sources = jsonRecord(state?.fieldSources);
  const labels: Record<string, string> = { pendingItems: 'Pending items', scheduledSigning: 'Scheduled signing', payoffExpiry: 'Payoff expiry', conditionNeeded: 'Conditions needed', hoiExpiration: 'Insurance expiration', completion1004D: '1004D', waterInspection: 'Water inspection', pestInspection: 'Pest inspection' };
  return {
    enabled: state?.enabled || false, lastSuccessAt: state?.lastSuccessAt?.toISOString() || null,
    lastAttemptAt: state?.lastAttemptAt?.toISOString() || null, nextAttemptAt: state?.nextAttemptAt?.toISOString() || null,
    error: state?.lastError || null, stage: typeof source.stage === 'string' ? source.stage : null,
    stageLabel: typeof source.stageLabel === 'string' ? source.stageLabel : null,
    stageDate: typeof source.stageDate === 'string' ? source.stageDate : null,
    conflicts: syncConflicts(state?.conflicts), issues,
    missingFields: [...new Set(issues.filter(i => /MISSING|INVALID|UNAVAILABLE|EMPTY|REMOVED|REGRESSED/.test(i.code)).map(i => i.field))],
    managedFields: Object.keys(jsonRecord(snapshot.managed)), canManage,
    serviceTrackers: serviceTrackerView(source.trackers, issues),
    structuredFields: Object.entries(structured).map(([key, value]) => {
      const provenance = jsonRecord(sources[key]);
      return { key, label: labels[key] || key, value: ariveSyncValue(value), author: typeof provenance.author === 'string' ? provenance.author : 'Arive', updatedAt: typeof provenance.effectiveAt === 'string' ? provenance.effectiveAt : null };
    }),
  };
}

/** Called only after the existing action's row access/version checks. Never makes an Arive write. */
export async function guardArivePipelineEdit(tx: Prisma.TransactionClient, current: ProcessingPipelineLoan, actorId: string, attempted: Record<string, unknown>) {
  if (current.loanId !== ARIVE_SYNC_PILOT.loanId) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${current.id}`}))`;
  const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId: current.id } });
  if (!state?.enabled) return null;
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
  if (current.loanId !== ARIVE_SYNC_PILOT.loanId) return;
  const state = await tx.arivePipelineSync.findUnique({ where: { pipelineId: current.id } });
  if (!state?.enabled) return;
  const managed = jsonRecord(jsonRecord(state.snapshot).managed);
  for (const field of [...Object.keys(managed), 'firstPaymentAt', 'sixthPaymentAt', 'rateLockRequestedAt', 'rateLockRequestedById']) {
    if (field in current) (data as Record<string, unknown>)[field] = (current as unknown as Record<string, unknown>)[field];
  }
}
