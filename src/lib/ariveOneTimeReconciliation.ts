import { createHash } from 'node:crypto';
import type { AriveNote } from './ariveClient';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';
import { inspectAriveLoanIdentity, normalizeAriveIdentity, type AriveLoanIdentity } from './ariveIdentity';
import { ariveRouteAfterApply, planAriveRolloutSync, type AriveRolloutCurrent, type AriveRolloutPlan } from './arivePipelineMapping';
import { ARIVE_STRUCTURED_NOTE_KEYS, parseAriveStructuredNotes, type AriveStructuredNoteKey, type AriveStructuredNoteSource } from './ariveStructuredNotes';
import { ariveSyncSameValue, ariveSyncValue, jsonRecord, syncConflicts } from './ariveSyncState';
import { ariveSyncFieldLabel, type AriveSyncIssue } from './ariveSyncTypes';

export type AriveOneTimeApproval = {
  portalLoanId: string; previousLoanNumber: string; ariveLoanId: string; ariveGuid: string;
  borrowerFirstName: string; borrowerLastName: string;
  applicantRole?: 'Borrower' | 'CoBorrower'; applicationSequence?: number | null;
};
export type AriveOneTimeLoan = AriveLoanIdentity & {
  amount: number | string | { toString(): string }; program: string | null; propertyAddress: string | null;
  borrowerPhone: string | null; borrowerEmail: string | null;
};
export type AriveOneTimeCurrent = AriveRolloutCurrent & {
  id: string; loanId: string; missingItemsCurrentStatus: string | null;
  loanType: string | null; propertyState: string | null; lender: string | null;
};
export type AriveOneTimePrevious = {
  ariveLoanId: string; ariveGuid: string | null; verifiedOriginatorEmail: string | null;
  snapshot: unknown; fieldSources: unknown; conflicts: unknown; routingProvenance: unknown;
  everFunded: boolean; collectedSnapshot: unknown;
};
export type AriveOneTimeReconciliationInput = {
  approved: AriveOneTimeApproval; loan: AriveOneTimeLoan; current: AriveOneTimeCurrent;
  details: unknown; trackers: unknown; notes: readonly AriveNote[];
  previous?: AriveOneTimePrevious | null; financialHistoryProtected: boolean;
  generation: number; now: Date; readStartedAt: Date;
};
export type AriveOneTimeLoanPatch = Partial<{
  loanNumber: string; borrowerName: string; borrowerFirstName: string; borrowerLastName: string;
  borrowerPhone: string; borrowerEmail: string; amount: number; program: string; propertyAddress: string;
}>;
export type AriveOneTimePipelinePatch = AriveRolloutPlan['patch'] & Partial<{
  missingItemsCurrentStatus: string | null; estimatedSigningAt: Date | null; payoffExpiresAt: Date | null;
  loanType: string; propertyState: string; lender: string;
}>;
export type AriveOneTimeChange = { entity: 'Loan' | 'ProcessingPipelineLoan'; field: string; previous: string | null; next: string | null };

const pipelineKeys = new Set([
  'sheet', 'pipelineStatus', 'statusChangedAt', 'movedAt', 'archivedAt', 'titleStatus', 'payoffStatus', 'hoiStatus',
  'payoffOrderedAt', 'hoiOrderedAt', 'appraisalNeeded', 'appraisalOrderedAt', 'appraisalScheduledAt', 'appraisalBackAt',
  'cdSent', 'cdWarningStartsAt', 'rateLock', 'rateLockExpiresAt', 'rateLockConfirmedAt', 'rateLockRequestedAt',
  'rateLockRequestedById', 'approvedWithConditionsAt', 'fundedAt', 'firstPaymentAt', 'sixthPaymentAt',
  'missingItemsCurrentStatus', 'estimatedSigningAt', 'payoffExpiresAt', 'loanType', 'propertyState', 'lender',
]);
const noteTargets: Partial<Record<AriveStructuredNoteKey, keyof AriveOneTimePipelinePatch>> = {
  pendingItems: 'missingItemsCurrentStatus', scheduledSigning: 'estimatedSigningAt', payoffExpiry: 'payoffExpiresAt',
};
function assert(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
function stable(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
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
function previousSources(value: unknown) {
  const out: Partial<Record<AriveStructuredNoteKey, AriveStructuredNoteSource>> = {};
  const source = jsonRecord(value);
  for (const key of ARIVE_STRUCTURED_NOTE_KEYS) {
    if (source[key] === undefined) continue;
    const v = jsonRecord(source[key]);
    const strings = ['noteId', 'author', 'createdAt', 'updatedAt', 'rawText', 'sectionText'] as const;
    assert(strings.every(field => typeof v[field] === 'string') && (v.parentNoteId === null || typeof v.parentNoteId === 'string')
      && (v.effectiveAt === null || typeof v.effectiveAt === 'string') && Number.isSafeInteger(v.sectionIndex) && Number(v.sectionIndex) >= 0, 'INVALID_PREVIOUS_NOTE_SOURCE');
    out[key] = { ...Object.fromEntries(strings.map(field => [field, v[field]])), parentNoteId: v.parentNoteId, effectiveAt: v.effectiveAt, sectionIndex: v.sectionIndex } as AriveStructuredNoteSource;
  }
  return out;
}
function normalizedNotes(notes: readonly AriveNote[], depth = 0): AriveNote[] {
  assert(Array.isArray(notes) && notes.length <= 5000 && depth <= 3, 'INVALID_COMPLETE_NOTES');
  return notes.map(note => {
    assert(note && ['id', 'text', 'author', 'createdAt', 'updatedAt'].every(key => typeof note[key as keyof AriveNote] === 'string')
      && note.id && Array.isArray(note.replies) && (depth < 3 || note.replies.length === 0), 'INVALID_COMPLETE_NOTES');
    return { id: note.id, text: note.text, author: note.author, createdAt: note.createdAt, updatedAt: note.updatedAt,
      replies: note.replies.length ? normalizedNotes(note.replies, depth + 1) : [] };
  });
}

/**
 * Pure one-time plan. The caller owns fresh complete reads, authorization, pause/credential
 * fencing, duplicate/practice checks and an atomic compare-and-swap commit. This never
 * enables a worker, rewrites historical tasks or writes to Arive, payroll or assignments.
 */
export function planAriveOneTimeReconciliation(input: AriveOneTimeReconciliationInput) {
  const { approved, loan, current, now, readStartedAt, previous } = input;
  assert(current.loanId === loan.id && approved.portalLoanId === loan.id && loan.loanNumber === approved.previousLoanNumber, 'APPROVED_PORTAL_IDENTITY_CHANGED');
  assert(/^\d{1,15}$/.test(approved.ariveLoanId) && /^[a-zA-Z0-9-]{1,100}$/.test(approved.ariveGuid)
    && normalizeAriveIdentity(approved.borrowerFirstName) && normalizeAriveIdentity(approved.borrowerLastName), 'INVALID_APPROVED_ARIVE_IDENTITY');
  assert(Number.isSafeInteger(current.version) && current.version >= 0 && Number.isSafeInteger(input.generation) && input.generation >= 0
    && Number.isFinite(now.getTime()) && Number.isFinite(readStartedAt.getTime()) && readStartedAt <= now, 'INVALID_RECONCILIATION_VERSION_OR_TIME');
  const previousSnapshot = jsonRecord(previous?.snapshot);
  const samePriorIdentity = !!previous && previous.ariveLoanId === approved.ariveLoanId && previous.ariveGuid === approved.ariveGuid;
  assert(!previous || samePriorIdentity || (!previous.ariveGuid && !Object.keys(previousSnapshot).length
    && !Object.keys(jsonRecord(previous.collectedSnapshot)).length && !Object.keys(jsonRecord(previous.fieldSources)).length
    && !Object.keys(jsonRecord(previous.routingProvenance)).length && !syncConflicts(previous.conflicts).length), 'PREVIOUS_ARIVE_LINK_REQUIRES_REVIEW');
  const identity = inspectAriveLoanIdentity(input.details, { ...loan, loanNumber: approved.ariveLoanId,
    borrowerFirstName: approved.borrowerFirstName, borrowerLastName: approved.borrowerLastName,
    borrowerName: `${approved.borrowerFirstName} ${approved.borrowerLastName}` },
  { ariveGuid: approved.ariveGuid, verifiedOriginatorEmail: samePriorIdentity ? previous?.verifiedOriginatorEmail : null });
  assert(identity.issues.length === 0 && identity.guid && identity.originatorEmail, `ARIVE_IDENTITY_FAILED_${identity.issues.join('_')}`);
  const details = jsonRecord(input.details);
  const modified = typeof details.modifiedDateTime === 'string' ? details.modifiedDateTime : null;
  if (modified && typeof previousSnapshot.modifiedDateTime === 'string') assert(!(Date.parse(modified) < Date.parse(previousSnapshot.modifiedDateTime)), 'ARIVE_SNAPSHOT_REGRESSED');
  const application = projectAriveApplicationSnapshot(details);
  const applicants = application.applicants.filter(person => normalizeAriveIdentity(person.firstName) === normalizeAriveIdentity(approved.borrowerFirstName)
    && normalizeAriveIdentity(person.lastName) === normalizeAriveIdentity(approved.borrowerLastName)
    && person.role === (approved.applicantRole ?? 'Borrower')
    && (approved.applicationSequence === undefined || person.applicationSequence === approved.applicationSequence));
  assert(applicants.length === 1 && applicants[0].firstName && applicants[0].lastName, 'APPROVED_APPLICANT_AMBIGUOUS_OR_MISSING');
  const applicant = applicants[0];
  const plan = planAriveRolloutSync({ details, trackers: input.trackers, current: { ...current, previousArive: previousObservation(previousSnapshot) }, now,
    everFunded: previous?.everFunded === true || jsonRecord(previous?.collectedSnapshot).everFunded === true || input.financialHistoryProtected,
    routingProvenance: previous?.routingProvenance ?? {}, generation: input.generation });
  const notes = normalizedNotes(input.notes);
  const fieldSources = previousSources(previous?.fieldSources);
  const parsed = parseAriveStructuredNotes(notes, fieldSources);
  const priorStructured = jsonRecord(previousSnapshot.structuredValues);
  const structuredValues: Partial<Record<AriveStructuredNoteKey, string | null>> = Object.fromEntries(ARIVE_STRUCTURED_NOTE_KEYS
    .filter(key => priorStructured[key] === null || typeof priorStructured[key] === 'string').map(key => [key, priorStructured[key]]));
  const pipelinePatch: AriveOneTimePipelinePatch = { ...plan.patch };
  const priorManaged = Object.fromEntries(Object.entries(jsonRecord(previousSnapshot.managed)).filter(([key]) => pipelineKeys.has(key)));
  const managed: Record<string, unknown> = { ...priorManaged, ...plan.managed };
  const issues: AriveSyncIssue[] = plan.issues.filter(issue => !['estimatedSigningAt', 'payoffExpiresAt'].includes(issue.field));
  for (const [key, field] of Object.entries(parsed.fields)) {
    if (field.action === 'KEEP') continue;
    const target = noteTargets[key as AriveStructuredNoteKey];
    structuredValues[key as AriveStructuredNoteKey] = field.action === 'CLEAR' ? null : field.value;
    if (field.source) fieldSources[key as AriveStructuredNoteKey] = field.source;
    if (target) {
      const value = field.action === 'CLEAR' ? null : target.endsWith('At') ? new Date(`${field.value}T00:00:00.000Z`) : field.value;
      Object.assign(pipelinePatch, { [target]: value }); managed[target] = value;
    }
  }
  for (const issue of parsed.issues) issues.push({ field: noteTargets[issue.field] || issue.field, code: issue.code,
    message: `${ariveSyncFieldLabel(noteTargets[issue.field] || issue.field)}: ${issue.code.replaceAll('_', ' ').toLowerCase()}. The previous value was retained; correct the source note in Arive.` });
  const effective = (field: keyof AriveOneTimeCurrent) => field in pipelinePatch ? (pipelinePatch as Record<string, unknown>)[field] : current[field];
  if (['DOCS_OUT', 'DOCS_SIGNED'].includes(plan.source.stage) && !effective('estimatedSigningAt')) issues.push({ field: 'estimatedSigningAt', code: 'MISSING_SIGNING_DATE', message: 'Documents are out/signed, but no valid Scheduled Signing note supplies a date.' });
  if (effective('payoffStatus') === 'RECEIVED' && !effective('payoffExpiresAt')) issues.push({ field: 'payoffExpiresAt', code: 'MISSING_PAYOFF_EXPIRY', message: 'Payoff is received, but no valid Payoff Expiry note supplies a date.' });

  // Missing/invalid source details do not erase known portal details. The full safe
  // snapshot still shows precisely what Arive supplied, including absent fields.
  const loanPatch: AriveOneTimeLoanPatch = { loanNumber: approved.ariveLoanId, borrowerName: `${applicant.firstName} ${applicant.lastName}`,
    borrowerFirstName: applicant.firstName!, borrowerLastName: applicant.lastName! };
  const missing = (field: string) => issues.push({ field, code: 'SOURCE_VALUE_UNAVAILABLE', message: `${ariveSyncFieldLabel(field)} was not safely supplied by Arive. The existing portal value was retained.` });
  const amount = application.loan.totalLoanAmount ?? application.loan.baseLoanAmount;
  const suppliedTotal = details.totalLoanAmount != null && !(typeof details.totalLoanAmount === 'string' && !details.totalLoanAmount.trim());
  const invalidSuppliedTotal = suppliedTotal && application.loan.totalLoanAmount === null;
  if (!invalidSuppliedTotal && amount !== null && amount >= 0 && amount <= 9_999_999_999.99 && Number.isSafeInteger(Math.round(amount * 100)) && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.001) loanPatch.amount = amount;
  else missing('loan.amount');
  if (applicant.mobilePhone || applicant.homePhone || applicant.workPhone) loanPatch.borrowerPhone = applicant.mobilePhone || applicant.homePhone || applicant.workPhone!;
  if (applicant.email) loanPatch.borrowerEmail = applicant.email;
  if (application.loan.lenderProductName) loanPatch.program = application.loan.lenderProductName;
  else if (loan.program) missing('loan.program');
  const property = application.property;
  if (property && property.addressTbd !== true && property.street && property.city && property.state && property.postalCode) {
    const zip = property.postalCode.replace(/^(\d{5})(\d{4})$/, '$1-$2');
    loanPatch.propertyAddress = [[property.street, property.unit].filter(Boolean).join(' '), property.city, `${property.state} ${zip}`].join(', ');
  } else missing('loan.propertyAddress');
  if (property?.state) pipelinePatch.propertyState = property.state;
  if (application.loan.mortgageType) pipelinePatch.loanType = application.loan.mortgageType;
  else if (current.loanType) missing('loanType');
  if (application.loan.lenderName) pipelinePatch.lender = application.loan.lenderName;
  else if (current.lender) missing('lender');
  for (const field of ['loanType', 'propertyState', 'lender'] as const) if (pipelinePatch[field] !== undefined) managed[field] = pipelinePatch[field];
  managed.pipelineStatus = pipelinePatch.pipelineStatus ?? current.pipelineStatus; managed.sheet = pipelinePatch.sheet ?? current.sheet;
  const canonicalLoan = { ...loanPatch };

  const changes: AriveOneTimeChange[] = [];
  const beforeValue = (entity: AriveOneTimeChange['entity'], field: string) => entity === 'Loan' && field === 'amount' ? Number(loan.amount.toString())
    : ((entity === 'Loan' ? loan : current) as unknown as Record<string, unknown>)[field];
  for (const [entity, patch] of [['Loan', loanPatch], ['ProcessingPipelineLoan', pipelinePatch]] as const) {
    for (const [field, value] of Object.entries(patch)) {
      const before = beforeValue(entity, field);
      if (ariveSyncSameValue(field, before, value)) { delete (patch as Record<string, unknown>)[field]; continue; }
      changes.push({ entity, field, previous: ariveSyncValue(before), next: ariveSyncValue(value) });
    }
  }
  assert(Object.keys(pipelinePatch).every(key => pipelineKeys.has(key)), 'UNSAFE_PIPELINE_PATCH');
  const conflicts = [...syncConflicts(previous?.conflicts)];
  for (const change of changes) {
    const isPipeline = change.entity === 'ProcessingPipelineLoan';
    const prior = isPipeline ? priorManaged : jsonRecord(previousSnapshot.canonicalLoan);
    const before = beforeValue(change.entity, change.field);
    if (change.field in prior ? !ariveSyncSameValue(change.field, before, prior[change.field]) : change.previous !== null) {
      const field = isPipeline ? change.field : `loan.${change.field}`;
      conflicts.push({ field, label: ariveSyncFieldLabel(field), portalValue: change.previous, ariveValue: change.next, detectedAt: now.toISOString() });
    }
  }
  const content = { source: plan.source, managed, structuredValues, application, canonicalLoan, modifiedDateTime: modified };
  const snapshot = plain({ ...content, readStartedAt: readStartedAt.toISOString() });
  const snapshotHash = digest({ snapshot: content, fieldSources, issues });
  const nextPipelineVersion = current.version + 1;
  const routingProvenance = ariveRouteAfterApply(current, plan, previous?.routingProvenance ?? {}, input.generation, nextPipelineVersion);
  return {
    loanPatch, pipelinePatch, changes, snapshot, snapshotHash, fieldSources: plain(fieldSources), conflicts: conflicts.slice(-30), issues,
    collectedSnapshot: plain({ source: plan.source, application, structuredValues, notes, issues, everFunded: plan.everFunded, changes }),
    notes, notesHash: digest(notes), sourceStage: plan.source.stage || null, everFunded: plan.everFunded,
    routingProvenance: plain(routingProvenance ?? {}), clearRateLockRequest: plan.clearRateLockRequest,
    verifiedIdentity: { ariveLoanId: approved.ariveLoanId, ariveGuid: identity.guid, verifiedOriginatorEmail: identity.originatorEmail }, nextPipelineVersion,
  };
}
