import type { PilotAriveProjection, ProcessingPipelineLoan } from '@prisma/client';
import type { AriveNote } from './ariveClient';
import { projectAriveApplicationSnapshot } from './ariveApplicationSnapshot';
import { inspectAriveLoanIdentity, normalizeAriveIdentity } from './ariveIdentity';
import { planAriveOneTimeReconciliation, type AriveOneTimeLoan } from './ariveOneTimeReconciliation';
import { ariveSyncSameValue, jsonRecord } from './ariveSyncState';
import { ariveSyncFieldLabel } from './ariveSyncTypes';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { stableAriveValue } from './ariveRollout';

export class PilotMatchReview extends Error {}

function comparableSnapshot(value: unknown) {
  const facts = {...jsonRecord(value)};
  const conflicts = facts.conflicts;
  for(const field of ['readStartedAt','modifiedDateTime','publishedAt','noteChangeEvidence']) delete facts[field];
  const comparableConflicts = Array.isArray(conflicts)
    ? conflicts.map((conflict) => {
        const fields = jsonRecord(conflict);
        return { field: fields.field, portalValue: fields.portalValue, ariveValue: fields.ariveValue };
      })
    : [];
  return { ...facts, conflicts: comparableConflicts };
}

export function pilotProjectionChanged(
  previous: PilotAriveProjection | null,
  projected: ReturnType<typeof leadershipPilotProjection>,
) {
  if (!previous?.collectedAt || previous.enrollmentStatus !== 'VERIFIED') return true;
  return (
    previous.everFunded !== projected.everFunded ||
    stableAriveValue(previous.notes) !== stableAriveValue(projected.notes) ||
    stableAriveValue(comparableSnapshot(previous.snapshot)) !== stableAriveValue(comparableSnapshot(projected.snapshot))
  );
}

/** A provider's top-level modifiedDateTime cannot date a tracker update or note.
 * Only newly observed, uniquely identified notes carry their creation timestamp. */
export function newNoteEvidence(prior: unknown, next: AriveNote[], sampledAt: Date) {
  type Source = { noteId: string; parentNoteId: string | null; createdAt: string };
  function collect(value: unknown, parent: string | null, seen: Map<string, Source | null>, depth: number) {
    if (!Array.isArray(value) || depth > 3) return;
    for (const item of value) {
      const note = jsonRecord(item);
      if (typeof note.id !== 'string' || !note.id) continue;
      const evidence = {
        noteId: note.id,
        parentNoteId: parent,
        createdAt: typeof note.createdAt === 'string' ? note.createdAt : '',
      };
      seen.set(note.id, seen.has(note.id) ? null : evidence);
      collect(note.replies, note.id, seen, depth + 1);
    }
  }
  if (!Array.isArray(prior)) return [];
  const before = new Map<string, Source | null>(),
    after = new Map<string, Source | null>();
  collect(prior, null, before, 0);
  collect(next, null, after, 0);
  return [...after.values()].filter(
    (source): source is Source =>
      !!source &&
      !before.has(source.noteId) &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(source.createdAt) &&
      parseArivePipelineDate(source.createdAt) !== null &&
      Date.parse(source.createdAt) <= +sampledAt,
  );
}

// Only these planner-controlled values may take precedence over staff data.
// In particular no ownership, payroll totals, approval or task fields qualify.
const pilotFields = new Set([
  'sheet',
  'pipelineStatus',
  'statusChangedAt',
  'movedAt',
  'archivedAt',
  'titleStatus',
  'payoffStatus',
  'hoiStatus',
  'payoffOrderedAt',
  'hoiOrderedAt',
  'appraisalNeeded',
  'appraisalOrderedAt',
  'appraisalScheduledAt',
  'appraisalBackAt',
  'cdSent',
  'cdWarningStartsAt',
  'rateLock',
  'rateLockExpiresAt',
  'rateLockConfirmedAt',
  'rateLockRequestedAt',
  'rateLockRequestedById',
  'approvedWithConditionsAt',
  'fundedAt',
  'firstPaymentAt',
  'sixthPaymentAt',
  'missingItemsCurrentStatus',
  'estimatedSigningAt',
  'payoffExpiresAt',
  'loanType',
  'propertyState',
  'lender',
]);

export function leadershipPilotProjection(input: {
  current: ProcessingPipelineLoan;
  loan: AriveOneTimeLoan;
  prior: PilotAriveProjection | null;
  previousVersion: number;
  guid: string;
  details: unknown;
  trackers: unknown;
  notes: AriveNote[];
  now: Date;
  started: Date;
  financialHistoryProtected: boolean;
}) {
  const { current, loan, prior, details } = input;
  const identity = inspectAriveLoanIdentity(details, loan, {
    ariveGuid: input.guid,
    verifiedOriginatorEmail: prior?.verifiedOriginatorEmail,
  });
  if (identity.issues.length || !identity.guid || !identity.originatorEmail)
    throw new PilotMatchReview('The exact loan, borrower or originator no longer matches. Review the Arive link.');
  const expected = normalizeAriveIdentity(
    loan.borrowerFirstName && loan.borrowerLastName
      ? `${loan.borrowerFirstName} ${loan.borrowerLastName}`
      : loan.borrowerName,
  );
  const matching = projectAriveApplicationSnapshot(details).applicants.filter(
    (person) => normalizeAriveIdentity(`${person.firstName ?? ''} ${person.lastName ?? ''}`) === expected,
  );
  if (matching.length !== 1 || !matching[0].firstName || !matching[0].lastName)
    throw new PilotMatchReview('Arive did not return one matching applicant.');
  const person = matching[0];
  const old = jsonRecord(prior?.snapshot);
  const overrides = Object.entries(jsonRecord(old.managed)).filter(([key]) => pilotFields.has(key));
  const effective = {
    ...current,
    ...Object.fromEntries(
      overrides.map(([key, value]) => [key, key.endsWith('At') && typeof value === 'string' ? new Date(value) : value]),
    ),
    version: input.previousVersion,
  };
  // A request submitted by staff since the last read needs fresh confirmation.
  const previousRequest = old.baseRateLockRequestedAt;
  const currentRequest = current.rateLockRequestedAt?.toISOString() ?? null;
  if (currentRequest !== previousRequest) {
    effective.rateLockRequestedAt = current.rateLockRequestedAt;
    effective.rateLockRequestedById = current.rateLockRequestedById;
  }
  const plan = planAriveOneTimeReconciliation({
    current: effective,
    loan,
    approved: {
      portalLoanId: loan.id,
      previousLoanNumber: loan.loanNumber,
      ariveLoanId: loan.loanNumber,
      ariveGuid: input.guid,
      borrowerFirstName: person.firstName!,
      borrowerLastName: person.lastName!,
      applicantRole: person.role,
      applicationSequence: person.applicationSequence,
    },
    previous: prior?.collectedAt
      ? {
          ariveLoanId: prior.ariveLoanId,
          ariveGuid: prior.ariveGuid,
          verifiedOriginatorEmail: prior.verifiedOriginatorEmail,
          snapshot: old,
          fieldSources: old.fieldSources,
          conflicts: [],
          routingProvenance: prior.routingProvenance,
          everFunded: prior.everFunded,
          collectedSnapshot: {},
        }
      : null,
    details,
    trackers: input.trackers,
    notes: input.notes,
    financialHistoryProtected: input.financialHistoryProtected,
    // Routing ownership is tied to this projection's own successive versions,
    // independently of a global operator pause/resume generation.
    generation: 0,
    now: input.now,
    readStartedAt: input.started,
  });
  const managed = { ...plan.snapshot.managed, ...plan.pipelinePatch };
  // Capture initial source-derived equal dates and sticky routing metadata in the
  // Pilot row, so later source reads can restore an archive or calculate SLAs.
  const sheet = plan.pipelinePatch.sheet ?? effective.sheet;
  const pipelineStatus = plan.pipelinePatch.pipelineStatus ?? effective.pipelineStatus;
  const archivedAt = plan.pipelinePatch.archivedAt === undefined ? effective.archivedAt : plan.pipelinePatch.archivedAt;
  Object.assign(managed, { sheet, pipelineStatus, archivedAt });
  if (currentRequest !== previousRequest && !plan.clearRateLockRequest) {
    delete managed.rateLockRequestedAt;
    delete managed.rateLockRequestedById;
  }
  const canonicalLoan = { ...jsonRecord(old.canonicalLoan), ...plan.snapshot.canonicalLoan };
  const staffComparisons: Array<[string, unknown, unknown]> = [
    ...Object.entries(managed).map(([field, value]): [string, unknown, unknown] => [
      field,
      current[field as keyof ProcessingPipelineLoan],
      value,
    ]),
    ...Object.entries(canonicalLoan).map(([field, value]): [string, unknown, unknown] => [
      `loan.${field}`,
      field === 'amount' ? Number(loan.amount) : loan[field as keyof AriveOneTimeLoan],
      value,
    ]),
  ];
  const conflicts = staffComparisons.flatMap(([field, staff, arive]) => {
    return !ariveSyncSameValue(field, staff, arive)
      ? [
          {
            field,
            label: ariveSyncFieldLabel(field),
            portalValue: staff instanceof Date ? staff.toISOString() : String(staff ?? ''),
            ariveValue: arive instanceof Date ? arive.toISOString() : String(arive ?? ''),
            detectedAt: input.now.toISOString(),
          },
        ]
      : [];
  });
  return {
    sheet,
    pipelineStatus,
    archivedAt,
    ariveGuid: identity.guid,
    verifiedOriginatorEmail: identity.originatorEmail,
    sourceStage: plan.sourceStage,
    everFunded: plan.everFunded,
    routingProvenance: plan.routingProvenance,
    snapshot: {
      ...plan.snapshot,
      publishedAt: input.now.toISOString(),
      managed,
      canonicalLoan,
      fieldSources: plan.fieldSources,
      issues: plan.issues,
      conflicts,
      noteChangeEvidence: newNoteEvidence(prior?.collectedAt ? prior.notes : null, plan.notes, input.now),
      baseRateLockRequestedAt: currentRequest,
    },
    notes: plan.notes,
    projectionVersion: plan.nextPipelineVersion,
  };
}
