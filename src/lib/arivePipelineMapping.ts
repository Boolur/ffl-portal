import type { ProcessingItemStatus, ProcessingPipelineLoan, ProcessingPipelineStatus } from '@prisma/client';
import { addMonthsClamped, getMortgageFirstPaymentDate } from './processingPipeline';

type OwnedField = 'sheet' | 'pipelineStatus' | 'statusChangedAt' | 'movedAt' | 'archivedAt'
  | 'titleStatus' | 'payoffStatus' | 'hoiStatus' | 'payoffOrderedAt' | 'hoiOrderedAt'
  | 'appraisalNeeded' | 'appraisalOrderedAt' | 'appraisalScheduledAt' | 'appraisalBackAt'
  | 'cdSent' | 'cdWarningStartsAt' | 'rateLock' | 'rateLockExpiresAt' | 'rateLockConfirmedAt'
  | 'rateLockRequestedAt' | 'rateLockRequestedById' | 'approvedWithConditionsAt' | 'fundedAt';
export type ArivePipelineCurrent = Pick<ProcessingPipelineLoan, OwnedField | 'estimatedSigningAt' | 'payoffExpiresAt'> & {
  previousArive?: {
    rateLock?: boolean; observedAt?: string;
    appraisal?: { status: string; needed: boolean };
  };
};
export type ArivePipelinePatch = Partial<Pick<ProcessingPipelineLoan, OwnedField>>;
export type ArivePipelineIssue = { field: string; code: string; message: string };
export type ArivePipelineTrackerStatus = { status: string; label: string; date: string | null };
export type ArivePipelineTracker = {
  name: string; label: string; status: string; statusLabel: string; date: string | null;
  history: ArivePipelineTrackerStatus[];
};
export type ArivePipelineSource = {
  stage: string; stageLabel: string; stageDate: string | null; adverseReason: string | null;
  archived: boolean; stageHistory: { stage: string; date: string | null }[];
  trackers: ArivePipelineTracker[];
};
export type ArivePipelinePlan = { patch: ArivePipelinePatch; managed: ArivePipelinePatch; source: ArivePipelineSource; issues: ArivePipelineIssue[]; clearRateLockRequest: boolean };

const stages: Record<string, string> = {
  APPLICATION_INTAKE: 'Application intake', QUALIFICATION: 'Qualification', PREAPPROVED: 'Preapproved',
  LOAN_SETUP: 'Loan setup', DISCLOSURE_SENT: 'Disclosures sent', UNDERWRITING_SUBMITTED: 'Submitted to underwriting',
  APPROVED_WITH_CONDITION: 'Approved with conditions', RE_SUBMITTAL: 'Resubmitted', CLEAR_TO_CLOSE: 'Clear to close',
  DOCS_OUT: 'Docs out', DOCS_SIGNED: 'Docs signed', LOAN_FUNDED: 'Funded', BROKER_CHECK_RECEIVED: 'Broker check received',
  COMMISSION_PAID: 'Commission paid', SUSPENDED: 'Suspended',
};
export const ARIVE_LOAN_STAGE_OPTIONS = Object.entries(stages).map(([value, label]) => ({ value, label }));
const stageMapping: Record<string, ProcessingPipelineStatus> = {
  UNDERWRITING_SUBMITTED: 'SUBBED_TO_UW', APPROVED_WITH_CONDITION: 'APPROVED_WITH_CONDITIONS',
  RE_SUBMITTAL: 'RE_SUB', CLEAR_TO_CLOSE: 'CTC', DOCS_OUT: 'DOCS_OUT',
};
const adverseReasons = new Set(['APP_DENIED_BY_LENDING_INSTITUTION', 'APP_APPROVED_BUT_NOT_ACCEPTED', 'APP_WITHDRAWN_BY_BORROWER', 'FILE_CLOSED_FOR_INCOMPLETENESS', 'PREAPPROVAL_APPROVED_BUT_NOT_ACCEPTED', 'PREAPPROVAL_DENIED', 'APP_RESCINDED_BY_BORROWER']);
const fundedStages = new Set(['LOAN_FUNDED', 'BROKER_CHECK_RECEIVED', 'COMMISSION_PAID']);
const itemMapping: Record<string, ProcessingItemStatus> = { NOT_ORDERED: 'NOT_STARTED', NOT_REQUESTED: 'NOT_STARTED', ORDERED: 'ORDERED', REQUESTED: 'ORDERED', RECEIVED: 'RECEIVED', WAIVED: 'NOT_APPLICABLE', NOT_NEEDED: 'NOT_APPLICABLE' };
function appraisalRequirement(status: string): boolean | undefined {
  if (['ORDERED', 'PAID', 'ASSIGNED', 'SCHEDULED', 'INSPECTED', 'RECEIVED', 'COMPLETE'].includes(status)) return true;
  if (['WAIVED', 'NOT_NEEDED'].includes(status)) return false;
  return undefined;
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function string(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function title(value: string): string { return value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()); }
function sourceDate(value: unknown, parsed: Date | null): string | null {
  return parsed ? typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : parsed.toISOString() : null;
}
/** Strict calendar validation; date-only values remain the supplied UTC calendar day. */
export function parseArivePipelineDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return null;
  const day = value.slice(0, 10); const calendar = new Date(`${day}T00:00:00.000Z`); const date = new Date(value);
  return Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === day && Number.isFinite(date.getTime()) ? date : null;
}

/** Pure inbound planner. Never changes assignments, financial approvals, payment dates, or portal notes. */
export function planArivePipelineSync(input: { details: unknown; trackers: unknown; current: ArivePipelineCurrent; now: Date }): ArivePipelinePlan {
  const details = record(input.details); const trackerResponse = record(input.trackers);
  if (!details || !trackerResponse || !Array.isArray(trackerResponse.loanTrackers) || !Number.isFinite(input.now.getTime())) throw new Error('Arive pipeline response is incomplete.');
  const patch: ArivePipelinePatch = {}; const issues: ArivePipelineIssue[] = [];
  const issue = (field: string, code: string, message: string) => { if (!issues.some(i => i.field === field && i.code === code)) issues.push({ field, code, message }); };
  const date = (value: unknown, field: string): Date | null => {
    const parsed = parseArivePipelineDate(value);
    if (value != null && value !== '' && !parsed) issue(field, 'INVALID_DATE', 'Arive supplied an invalid date; no date was invented.');
    return parsed;
  };
  const milestone = (raw: unknown, field: string): ArivePipelineTrackerStatus => {
    const entry = record(raw); if (!entry || !string(entry.name)) throw new Error('Arive returned an invalid tracker status.');
    return { status: string(entry.name), label: string(entry.displayName) || title(string(entry.name)), date: sourceDate(entry.date, date(entry.date, field)) };
  };
  const trackers: ArivePipelineTracker[] = trackerResponse.loanTrackers.map((raw: unknown) => {
    const t = record(raw); if (!t || !string(t.name)) throw new Error('Arive returned an invalid tracker.');
    const name = string(t.name); const rawCurrent = Array.isArray(t.currentTrackerStatus) ? t.currentTrackerStatus : t.currentTrackerStatus == null ? [] : [t.currentTrackerStatus];
    if (rawCurrent.length > 1) issue(name, 'AMBIGUOUS_TRACKER_STATUS', 'Arive returned multiple current statuses; the portal field was retained.');
    const current = rawCurrent.length === 1 ? milestone(rawCurrent[0], name) : null;
    if (t.trackerStatusesHistory != null && !Array.isArray(t.trackerStatusesHistory)) throw new Error('Arive returned invalid tracker history.');
    const history = (Array.isArray(t.trackerStatusesHistory) ? t.trackerStatusesHistory : []).map(s => milestone(s, name));
    return { name, label: string(t.displayName) || title(name), status: current?.status ?? '', statusLabel: current?.label ?? 'Not supplied', date: current?.date ?? null, history };
  });
  const currentStatus = record(details.currentLoanStatus);
  const stage = string(currentStatus?.status); const stageDate = date(currentStatus?.date, 'statusChangedAt');
  if (details.loanStatusHistory != null && !Array.isArray(details.loanStatusHistory)) throw new Error('Arive returned invalid loan stage history.');
  const stageHistory = (Array.isArray(details.loanStatusHistory) ? details.loanStatusHistory : []).map((raw: unknown) => {
    const entry = record(raw); if (!entry || !string(entry.status)) throw new Error('Arive returned an invalid loan stage history entry.');
    return { stage: string(entry.status), date: sourceDate(entry.date, date(entry.date, 'stageHistory')) };
  });
  if (stage && stageDate && !stageHistory.some(s => s.stage === stage && s.date && Date.parse(s.date) === stageDate.getTime())) stageHistory.push({ stage, date: sourceDate(currentStatus?.date, stageDate) });
  const reason = string(currentStatus?.adverseReason) || (adverseReasons.has(stage) ? stage : '');
  const isAdverse = adverseReasons.has(reason);
  if (reason && !isAdverse) issue('adverseReason', 'UNKNOWN_ADVERSE_REASON', 'Arive supplied an unfamiliar adverse reason; no automatic removal was performed.');
  const source: ArivePipelineSource = { stage, stageLabel: stages[stage] || title(stage) || 'Not supplied', stageDate: sourceDate(currentStatus?.date, stageDate), adverseReason: reason || null, archived: details.archiveIndicator === true, stageHistory, trackers };
  const latestStageDate = (name: string) => latest(stageHistory.filter(s => s.stage === name).map(s => s.date));
  const knownStage = Boolean(stages[stage]);
  if (!knownStage && !isAdverse) issue('pipelineStatus', 'UNKNOWN_STAGE', 'Arive supplied an unknown or missing stage; the portal routing was retained.');
  if (knownStage && !stageDate) issue('statusChangedAt', 'MISSING_DATE', 'The Arive stage is visible, but its milestone date is missing.');
  if (stage === 'DOCS_OUT' && !input.current.estimatedSigningAt) issue('estimatedSigningAt', 'MISSING_DATE', 'Arive reports Docs Out; the estimated signing date still needs to be supplied.');
  if (details.archiveIndicator === true && !isAdverse) issue('archivedAt', 'ARCHIVE_REVIEW', 'Arive archived this file without a confirmed adverse reason; review its portal routing.');

  const protectedRoute = input.current.archivedAt !== null || (input.current.sheet === 'FUNDING' && !fundedStages.has(stage));
  if (input.current.archivedAt && !isAdverse) issue('archivedAt', 'ARCHIVED_REVIEW', 'An inactive portal file is not restored automatically.');
  if (input.current.sheet === 'FUNDING' && !fundedStages.has(stage) && !isAdverse) issue('sheet', 'FUNDED_REVERSAL_REVIEW', 'Arive moved behind funding; financial routing needs manager review.');
  if (isAdverse) {
    if (input.current.sheet === 'FUNDING') issue('archivedAt', 'FUNDED_ADVERSE_REVIEW', 'Arive reports adverse action after funding. The file remains in Fundings until a manager reviews the financial impact.');
    else if (!input.current.archivedAt) patch.archivedAt = new Date(input.now); // Portal removal time, never a fabricated Arive milestone.
  } else if (!protectedRoute && knownStage) {
    if (stageDate) patch.statusChangedAt = stageDate;
    if (stage === 'SUSPENDED') { patch.sheet = 'RESTRUCTURE'; patch.pipelineStatus = 'SUSPENDED_RESTRUCTURE'; }
    else if (fundedStages.has(stage)) {
      patch.sheet = 'FUNDING'; patch.pipelineStatus = 'FUNDED';
      patch.fundedAt = latestStageDate('LOAN_FUNDED');
      if (!patch.fundedAt) issue('fundedAt', 'MISSING_DATE', 'Arive reports funding but did not supply the funded milestone date.');
    } else if (stageMapping[stage]) { patch.pipelineStatus = stageMapping[stage]; patch.sheet = 'PIPELINE'; }
    else if (input.current.sheet === 'RESTRUCTURE') issue('sheet', 'EARLY_STAGE_ROUTE_REVIEW', 'The actual Arive stage is shown; returning this restructure needs review.');
    if (patch.sheet && patch.sheet !== input.current.sheet && stageDate) patch.movedAt = stageDate;
  }
  patch.approvedWithConditionsAt = latestStageDate('APPROVED_WITH_CONDITION');
  if (stage === 'APPROVED_WITH_CONDITION' && !patch.approvedWithConditionsAt) issue('approvedWithConditionsAt', 'MISSING_DATE', 'The approval milestone date needed for reminders is missing.');

  const keyDates = record(details.keyDates) ?? {};
  const one = (name: string): ArivePipelineTracker | null => {
    const found = trackers.filter(t => t.name === name);
    if (found.length !== 1 || !found[0].status) { issue(name, found.length > 1 ? 'DUPLICATE_TRACKER' : 'MISSING_TRACKER_STATUS', 'Arive did not return one confirmed current tracker status; the portal field was retained.'); return null; }
    return found[0];
  };
  const trackerDate = (t: ArivePipelineTracker, names: readonly string[]) => latest([...t.history, { status: t.status, label: t.statusLabel, date: t.date }].filter(s => names.includes(s.status)).map(s => s.date));
  const actualDate = (field: string, key: string | null, tracker: ArivePipelineTracker, names: readonly string[]) => (key ? date(keyDates[key], field) : null) ?? trackerDate(tracker, names);
  for (const [name, field] of [['TITLE', 'titleStatus'], ['HOI', 'hoiStatus'], ['PAYOFFS', 'payoffStatus']] as const) {
    const t = one(name); if (!t) continue;
    const status = itemMapping[t.status];
    if (!status) { issue(field, 'UNMAPPED_TRACKER_STATUS', 'The actual Arive status is shown; no equivalent portal service state is confirmed.'); continue; }
    patch[field] = status;
    if (name === 'PAYOFFS' && status === 'RECEIVED' && !input.current.payoffExpiresAt) issue('payoffExpiresAt', 'MISSING_DATE', 'Arive reports the payoff received; its expiration date still needs to be supplied.');
    if (name === 'HOI' || name === 'PAYOFFS') {
      const dateField = name === 'HOI' ? 'hoiOrderedAt' : 'payoffOrderedAt';
      patch[dateField] = actualDate(dateField, name === 'HOI' ? 'hoiOrderedDate' : null, t, ['ORDERED', 'REQUESTED']);
      if (status === 'ORDERED' && !patch[dateField]) issue(dateField, 'MISSING_DATE', 'The service was ordered, but Arive did not supply its order date.');
    }
  }
  const appraisal = one('APPRAISAL');
  if (appraisal) {
    const inferredNeeded = appraisalRequirement(appraisal.status);
    const inProgress = inferredNeeded === true;
    const recognized = inferredNeeded !== undefined || appraisal.status === 'NOT_ORDERED';
    const previous = input.current.previousArive?.appraisal;
    if (inferredNeeded !== undefined) patch.appraisalNeeded = inferredNeeded;
    else if (appraisal.status === 'NOT_ORDERED' && previous
      && appraisalRequirement(previous.status) === previous.needed
      && input.current.appraisalNeeded === previous.needed) {
      // Not ordered does not establish whether an appraisal is required. Clear
      // only the inference from the preceding confirmed Arive state, never an
      // independent portal requirement or a value retained through unknown data.
      patch.appraisalNeeded = null;
    }
    else if (appraisal.status !== 'NOT_ORDERED') issue('appraisalNeeded', 'UNMAPPED_TRACKER_STATUS', 'The actual Arive appraisal state is shown; appraisal requirements were retained.');
    if (recognized) {
      patch.appraisalOrderedAt = actualDate('appraisalOrderedAt', 'appraisalOrderedDate', appraisal, ['ORDERED']);
      patch.appraisalScheduledAt = trackerDate(appraisal, ['SCHEDULED']);
      // Arive's appraisal tracker also names its final status COMPLETE. Keep the
      // actual supplied receipt/completion date; borrower delivery is not proof.
      patch.appraisalBackAt = trackerDate(appraisal, ['RECEIVED', 'COMPLETE']);
      if (inProgress && !patch.appraisalOrderedAt) issue('appraisalOrderedAt', 'MISSING_DATE', 'Arive did not supply the appraisal order date needed for reminders.');
      if (['RECEIVED', 'COMPLETE'].includes(appraisal.status) && !patch.appraisalBackAt) issue('appraisalBackAt', 'MISSING_DATE', 'Arive reports the appraisal received or complete, but its receipt/completion date is missing.');
    }
  }
  const cd = one('CD');
  if (cd) {
    if (['SENT', 'SIGNED'].includes(cd.status)) patch.cdSent = true;
    else if (cd.status === 'NOT_SENT') patch.cdSent = false;
    else issue('cdSent', 'UNMAPPED_TRACKER_STATUS', 'The actual Arive CD state is shown; the portal sent flag was retained.');
  }
  let clearRateLockRequest = false;
  const lock = one('RATE_LOCK');
  if (lock) {
    if (lock.status === 'Locked') {
      const confirmedAt = date(details.lockDate, 'rateLockConfirmedAt') ?? trackerDate(lock, ['Locked']);
      patch.rateLock = true; patch.rateLockConfirmedAt = confirmedAt; patch.cdWarningStartsAt = confirmedAt;
      patch.rateLockExpiresAt = date(details.lockExpirationDate, 'rateLockExpiresAt');
      if (!confirmedAt) issue('rateLockConfirmedAt', 'MISSING_DATE', 'Arive confirms a lock but its date is missing; an outstanding request was not cleared.');
      if (!patch.rateLockExpiresAt) issue('rateLockExpiresAt', 'MISSING_DATE', 'Arive confirms a lock but its expiration date is missing.');
      if (input.current.rateLockRequestedAt && confirmedAt) {
        clearRateLockRequest = confirmedAt.getTime() >= input.current.rateLockRequestedAt.getTime();
        const previous = input.current.previousArive;
        const previousObserved = parseArivePipelineDate(previous?.observedAt);
        const sameDay = confirmedAt.toISOString().slice(0, 10) === input.current.rateLockRequestedAt.toISOString().slice(0, 10);
        // A date-only lock cannot prove ordering within a day. A recorded unlocked
        // snapshot after this exact request provides independent transition evidence.
        if (!clearRateLockRequest && typeof details.lockDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(details.lockDate)
          && sameDay && previous?.rateLock === false && previousObserved
          && previousObserved.getTime() >= input.current.rateLockRequestedAt.getTime() && previousObserved.getTime() <= input.now.getTime()) clearRateLockRequest = true;
        if (clearRateLockRequest) { patch.rateLockRequestedAt = null; patch.rateLockRequestedById = null; }
        else issue('rateLockRequestedAt', 'STALE_LOCK_CONFIRMATION', 'The Arive lock predates the portal request; the request remains open.');
      }
    } else if (['None', 'Requested', 'Expired', 'Rejected'].includes(lock.status)) {
      patch.rateLock = false; patch.rateLockConfirmedAt = null; patch.cdWarningStartsAt = null;
      patch.rateLockExpiresAt = date(details.lockExpirationDate, 'rateLockExpiresAt');
    } else issue('rateLock', 'UNMAPPED_TRACKER_STATUS', 'The Arive lock state is unfamiliar; the portal lock state and request were retained.');
  }
  // Authority includes confirmed values which already match the portal. Request
  // metadata and local routing-action timestamps remain portal workflow fields.
  const managed = { ...patch };
  for (const field of ['rateLockRequestedAt', 'rateLockRequestedById', 'movedAt', 'archivedAt'] as const) delete managed[field];
  // Only actual changes belong in the mutation/audit. Repeating a snapshot is a no-op.
  for (const field of Object.keys(patch) as OwnedField[]) {
    const before = input.current[field]; const after = patch[field];
    if (before instanceof Date && after instanceof Date ? before.getTime() === after.getTime() : before === after) delete patch[field];
  }
  return { patch, managed, source, issues, clearRateLockRequest };
}
function latest(values: (string | null)[]): Date | null {
  const timestamps = values.flatMap(value => value ? [Date.parse(value)] : []).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export type AriveRoutingProvenance = {
  kind: 'ARCHIVE' | 'RESTRUCTURE'; generation: number; pipelineVersion: number;
  sheet: string; pipelineStatus: string; archivedAt: string | null;
  archivedById: string | null; movedAt: string | null;
};
export type AriveRolloutCurrent = ArivePipelineCurrent & Pick<ProcessingPipelineLoan, 'version' | 'archivedById' | 'firstPaymentAt' | 'sixthPaymentAt'>;
export type AriveRolloutPlan = Omit<ArivePipelinePlan, 'patch'> & {
  patch: ArivePipelinePatch & Partial<Pick<ProcessingPipelineLoan, 'firstPaymentAt' | 'sixthPaymentAt'>>;
  everFunded: boolean; ownsPreviousRoute: boolean;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
export function ownsAriveRoute(current: AriveRolloutCurrent, provenance: unknown, generation: number): provenance is AriveRoutingProvenance {
  const p = record(provenance);
  return !!p && ['ARCHIVE', 'RESTRUCTURE'].includes(String(p.kind)) && p.generation === generation
    && p.pipelineVersion === current.version && p.sheet === current.sheet && p.pipelineStatus === current.pipelineStatus
    && p.archivedAt === iso(current.archivedAt) && p.archivedById === current.archivedById && p.movedAt === iso(current.movedAt);
}

/** Generalized routing is opt-in; the deployed exact-file pilot keeps its existing rules. */
export function planAriveRolloutSync(input: {
  details: unknown; trackers: unknown; current: AriveRolloutCurrent; now: Date;
  everFunded: boolean; routingProvenance: unknown; generation: number;
}): AriveRolloutPlan {
  const d = record(input.details) ?? {}; const s = record(d.currentLoanStatus) ?? {};
  const history = Array.isArray(d.loanStatusHistory) ? d.loanStatusHistory : [];
  const stage = string(s.status); const reason = string(s.adverseReason);
  const previouslyFunded = input.everFunded || input.current.sheet === 'FUNDING' || input.current.fundedAt !== null;
  const everFunded = previouslyFunded
    || fundedStages.has(stage) || history.some(h => fundedStages.has(string(record(h)?.status)));
  const ownsPreviousRoute = ownsAriveRoute(input.current, input.routingProvenance, input.generation);
  const invalidAdverse = s.adverseReason != null && typeof s.adverseReason !== 'string';
  const active = Boolean(stages[stage]) && stage !== 'SUSPENDED' && !fundedStages.has(stage) && !reason && !invalidAdverse && d.archiveIndicator === false;
  const mayRestore = ownsPreviousRoute && !reason && !invalidAdverse && d.archiveIndicator === false
    && (active && !everFunded || fundedStages.has(stage) && !previouslyFunded);
  const adjusted = { ...input.current,
    ...(mayRestore ? { archivedAt: null, sheet: 'PIPELINE' as const } : {}),
    ...(everFunded && !fundedStages.has(stage) ? { sheet: 'FUNDING' as const } : {}),
  };
  const base = planArivePipelineSync({ ...input, current: adjusted });
  const patch: AriveRolloutPlan['patch'] = { ...base.patch };
  if (mayRestore && input.current.archivedAt) patch.archivedAt = null;
  const issues = [...base.issues];
  const blockedManualRoute = input.current.sheet === 'RESTRUCTURE' && active && !mayRestore;
  const blockedArchive = input.current.archivedAt !== null && !mayRestore;
  const uncertainActive = typeof d.archiveIndicator !== 'boolean' || invalidAdverse || Boolean(reason) && !adverseReasons.has(reason) || d.archiveIndicator === true && !adverseReasons.has(reason);
  if (typeof d.archiveIndicator !== 'boolean') issues.push({ field: 'archivedAt', code: 'ARCHIVE_INDICATOR_UNAVAILABLE', message: 'Arive did not confirm whether the file is archived. Portal routing was retained until that indicator is available.' });
  if (invalidAdverse) issues.push({ field: 'adverseReason', code: 'ADVERSE_INDICATOR_UNAVAILABLE', message: 'Arive returned an invalid adverse indicator. Portal routing was retained for review.' });
  if (blockedManualRoute || blockedArchive || uncertainActive) {
    for (const field of ['sheet', 'pipelineStatus', 'statusChangedAt', 'movedAt', 'archivedAt', 'fundedAt'] as const) {
      delete patch[field]; delete base.managed[field];
    }
    if (blockedManualRoute) issues.push({ field: 'sheet', code: 'MANUAL_ROUTE_REVIEW', message: 'This restructure is not owned by the current Arive sync event. A manager must confirm its return.' });
  } else if (active && !everFunded) {
    patch.sheet = 'PIPELINE';
    // Exact sourceStage is stored separately. These compatibility values keep
    // existing forms and reporting valid until their source-stage UI is adopted.
    patch.pipelineStatus = stageMapping[stage] ?? (stage === 'DOCS_SIGNED' ? 'DOCS_OUT' : 'PENDING_APPROVAL');
    base.managed.sheet = patch.sheet; base.managed.pipelineStatus = patch.pipelineStatus;
    if (input.current.archivedAt) patch.archivedAt = null;
    if (input.current.sheet !== 'PIPELINE') {
      const at = parseArivePipelineDate(base.source.stageDate); if (at) patch.movedAt = at;
    }
  }
  if (fundedStages.has(stage) && !blockedArchive && !uncertainActive && patch.fundedAt instanceof Date) {
    if (input.current.firstPaymentAt === null) patch.firstPaymentAt = getMortgageFirstPaymentDate(patch.fundedAt);
    if (input.current.sixthPaymentAt === null) patch.sixthPaymentAt = addMonthsClamped(patch.fundedAt, 6);
  } else if (fundedStages.has(stage) && !blockedArchive && !uncertainActive) {
    // An equal fundedAt is omitted by the base planner; only the confirmed
    // source milestone can supply missing payment dates, never a retained date.
    const actual = latest(base.source.stageHistory.filter(h => h.stage === 'LOAN_FUNDED').map(h => h.date));
    if (actual) {
      if (input.current.firstPaymentAt === null) patch.firstPaymentAt = getMortgageFirstPaymentDate(actual);
      if (input.current.sixthPaymentAt === null) patch.sixthPaymentAt = addMonthsClamped(actual, 6);
    }
  }
  const confirmedFunding = fundedStages.has(stage) ? latest(base.source.stageHistory.filter(h => h.stage === 'LOAN_FUNDED').map(h => h.date)) : null;
  if (confirmedFunding) {
    for (const [field, expected] of [['firstPaymentAt', getMortgageFirstPaymentDate(confirmedFunding)], ['sixthPaymentAt', addMonthsClamped(confirmedFunding, 6)]] as const) {
      const existing = input.current[field];
      if (existing && existing.toISOString().slice(0, 10) !== expected.toISOString().slice(0, 10)) issues.push({ field, code: 'PAYMENT_DATE_DISAGREEMENT', message: `The existing ${field === 'firstPaymentAt' ? 'first' : 'sixth'} payment date differs from the date calculated from Arive funding. The existing portal date was preserved for review.` });
    }
  }
  for (const [field, value] of Object.entries(patch)) {
    const before = input.current[field as keyof AriveRolloutCurrent];
    if (before instanceof Date && value instanceof Date ? before.getTime() === value.getTime() : before === value) delete (patch as Record<string, unknown>)[field];
  }
  return { ...base, patch, issues, everFunded, ownsPreviousRoute };
}

export function ariveRouteAfterApply(current: AriveRolloutCurrent, plan: AriveRolloutPlan, previous: unknown, generation: number, nextVersion: number): AriveRoutingProvenance | null {
  const next = { ...current, ...plan.patch };
  const kind = plan.patch.archivedAt instanceof Date ? 'ARCHIVE'
    : plan.patch.sheet === 'RESTRUCTURE' ? 'RESTRUCTURE'
      : plan.ownsPreviousRoute && (next.archivedAt || next.sheet === 'RESTRUCTURE') ? record(previous)?.kind : null;
  if (kind !== 'ARCHIVE' && kind !== 'RESTRUCTURE') return null;
  return { kind, generation, pipelineVersion: nextVersion, sheet: next.sheet, pipelineStatus: next.pipelineStatus,
    archivedAt: iso(next.archivedAt), archivedById: next.archivedById, movedAt: iso(next.movedAt) };
}
