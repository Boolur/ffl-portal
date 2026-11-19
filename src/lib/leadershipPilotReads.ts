import { Prisma, ProcessingPipelineStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AriveLoanIdentity } from './ariveIdentity';
import { pilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { ariveSyncView, jsonRecord } from './ariveSyncState';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { isPilotAccessDenied, type AriveSyncView } from './ariveSyncTypes';
import { buildProcessingPipelineScopeWhere, type ProcessingPipelineScopeActor } from './processingPipeline';

export const pilotIdentitySelect = {
  id: true,
  loanNumber: true,
  borrowerName: true,
  borrowerFirstName: true,
  borrowerLastName: true,
  loanOfficer: { select: { id: true, name: true, email: true } },
  secondaryLoanOfficer: { select: { id: true, name: true, email: true } },
} satisfies Prisma.LoanSelect;

type Projection = {
  pipelineId: string;
  ariveLoanId: string;
  ariveGuid: string | null;
  identityHash: string | null;
  enrollmentStatus: string;
  enrollmentIssue: string | null;
  sourceStage: string | null;
  sheet?: string | null;
  archivedAt?: Date | null;
  lastError: string | null;
  collectedAt: Date | null;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  manualRefreshRequestedAt: Date | null;
  projectionVersion: number;
  pilotRefreshHold?: AriveSyncView['pilotRefreshHold'] | null;
  reviewConnectionCurrent?: boolean;
  snapshot: Prisma.JsonValue;
  notes?: Prisma.JsonValue;
};
export function usablePilotProjection(loan: AriveLoanIdentity, projection: Projection | undefined | null) {
  return (
    !!projection &&
    projection.enrollmentStatus === 'VERIFIED' &&
    !!projection.ariveGuid &&
    !!projection.collectedAt &&
    projection.ariveLoanId === loan.loanNumber &&
    projection.identityHash === pilotIdentityHash(loan)
  );
}

function currentReviewEvidence(loan: AriveLoanIdentity, projection: Projection) {
  return projection.reviewConnectionCurrent === true && projection.ariveLoanId === loan.loanNumber &&
    projection.identityHash === pilotIdentityHash(loan);
}

const managedPipelineFields = [
  'sheet',
  'pipelineStatus',
  'statusChangedAt',
  'estimatedSigningAt',
  'titleStatus',
  'payoffStatus',
  'payoffOrderedAt',
  'payoffExpiresAt',
  'hoiStatus',
  'hoiOrderedAt',
  'appraisalNeeded',
  'appraisalNotes',
  'appraisalOrderedAt',
  'appraisalScheduledAt',
  'appraisalBackAt',
  'cdSent',
  'cdWarningStartsAt',
  'rateLockExpiresAt',
  'rateLockConfirmedAt',
  'rateLockRequestedAt',
  'rateLockRequestedById',
  'rateLock',
  'missingItemsCurrentStatus',
  'approvedWithConditionsAt',
  'loanType',
  'propertyState',
  'lender',
  'fundedAt',
  'firstPaymentAt',
  'sixthPaymentAt',
  'movedAt',
  'archivedAt',
] as const;
const managedLoanFields = [
  'borrowerName',
  'borrowerFirstName',
  'borrowerLastName',
  'borrowerEmail',
  'borrowerPhone',
  'propertyAddress',
  'amount',
  'program',
] as const;

/** Apply only source-owned facts to this response. Ownership, financials and workflow IDs always come from BISU. */
function overlay<T extends object>(base: T, values: unknown, fields: readonly string[]): T {
  const result = { ...base };
  const supplied = jsonRecord(values);
  for (const field of fields) {
    if (!(field in base) || !(field in supplied)) continue;
    const value = supplied[field];
    if (value !== null && !['string', 'boolean', 'number'].includes(typeof value)) continue;
    let typed = value;
    if (field.endsWith('At') && value !== null) {
      const date = new Date(String(value));
      if (!Number.isFinite(date.getTime())) continue;
      typed = date;
    } else if (field === 'amount') {
      if (value === null || !Number.isFinite(Number(value))) continue;
      typed = new Prisma.Decimal(String(value));
    }
    Reflect.set(result, field, typed);
  }
  return result;
}
export function effectivePilotRow<T extends { loan: AriveLoanIdentity }>(
  row: T,
  projection: Projection | undefined | null,
): T {
  if (!usablePilotProjection(row.loan, projection)) return row;
  const snapshot = jsonRecord(projection!.snapshot);
  const record = overlay(row, snapshot.managed, managedPipelineFields);
  const stageDate = parseArivePipelineDate(jsonRecord(snapshot.source).stageDate);
  if (stageDate && 'statusChangedAt' in record) Reflect.set(record, 'statusChangedAt', stageDate);
  return { ...record, loan: overlay(row.loan, snapshot.canonicalLoan, managedLoanFields) };
}

export function pilotSyncView(loan: AriveLoanIdentity, projection: Projection | undefined): AriveSyncView {
  const usable = usablePilotProjection(loan, projection);
  const snapshot = usable ? jsonRecord(projection?.snapshot) : {};
  const status =
    projection?.enrollmentStatus === 'VERIFIED' && !usable
      ? projection.collectedAt
        ? 'REVIEW'
        : 'PENDING'
      : (projection?.enrollmentStatus ?? 'PENDING');
  const state = {
    workerOwner: 'GENERALIZED',
    enabled: usable,
    operatorPaused: false,
    snapshot: snapshot as Prisma.JsonObject,
    issues: (snapshot.issues ?? []) as Prisma.JsonValue,
    fieldSources: (snapshot.fieldSources ?? {}) as Prisma.JsonValue,
    conflicts: (snapshot.conflicts ?? []) as Prisma.JsonValue,
    lastSuccessAt: usable ? projection!.collectedAt : null,
    lastAttemptAt: projection?.lastAttemptAt ?? null,
    nextAttemptAt: projection?.nextAttemptAt ?? null,
    manualRefreshRequestedAt: projection?.manualRefreshRequestedAt ?? null,
    lastError: status === 'REVIEW' && projection && !currentReviewEvidence(loan, projection)
      ? 'This loan needs a new identity and access check on the current branch connection.'
      : projection?.lastError || projection?.enrollmentIssue || null,
  };
  return {
    ...ariveSyncView(state, true, false, true)!,
    pilotPreview: true,
    pilotRefreshHold: projection?.pilotRefreshHold ?? undefined,
    enrollmentStatus: status,
    projectionVersion: usable ? projection!.projectionVersion : undefined,
  };
}

/** The manifest needs only routing, filters and identity. Avoid sending 1003s, notes or raw source responses through the grid. */
export async function readPilotProjections(ids: string[], detail: boolean | 'noteEvidence' | 'coverage' = false) {
  if (!ids.length) return new Map<string, Projection>();
  const full = detail === true;
  const snapshot =
    detail === 'coverage' ? Prisma.sql`'{}'::jsonb` : detail === 'noteEvidence'
      ? Prisma.sql`jsonb_build_object('noteChangeEvidence', "snapshot"->'noteChangeEvidence', 'publishedAt', "snapshot"->'publishedAt')`
      : full
        ? Prisma.sql`"snapshot"`
        : Prisma.sql`jsonb_build_object(
    'managed', "snapshot"->'managed', 'canonicalLoan', "snapshot"->'canonicalLoan', 'issues', "snapshot"->'issues', 'publishedAt', "snapshot"->'publishedAt',
    'source', jsonb_build_object('stage', "sourceStage", 'stageLabel', "snapshot"#>'{source,stageLabel}', 'stageDate', "snapshot"#>'{source,stageDate}'))`;
  // Start from the requested IDs so a newly submitted loan can report its actual
  // admission state before the scheduled worker creates its first projection.
  const rows = await prisma.$queryRaw<Projection[]>`WITH capacity AS (
    SELECT "enabled", "cohortLimit" IS NOT NULL AND "cohortLimit" <= (
      SELECT count(*) FROM "PilotAriveProjection" WHERE "enrollmentStatus"='VERIFIED'
        OR ("leaseToken" IS NOT NULL AND "leaseUntil">CURRENT_TIMESTAMP)
    ) AS full FROM "PilotAriveControl" WHERE "id"='company'
  )
  SELECT requested.id AS "pipelineId","ariveLoanId","ariveGuid","identityHash",
    CASE WHEN capacity.enabled IS NOT TRUE THEN 'PAUSED'
      WHEN capacity.full AND COALESCE("enrollmentStatus",'PENDING') NOT IN ('VERIFIED','EXCLUDED')
        AND ("leaseToken" IS NULL OR "leaseUntil" IS NULL OR "leaseUntil"<=CURRENT_TIMESTAMP)
      THEN 'COHORT_FULL' END AS "pilotRefreshHold",
    COALESCE("connectionRevision"=connection."updatedAt", FALSE) AS "reviewConnectionCurrent",
    CASE WHEN "enrollmentStatus" = 'VERIFIED' AND ("connectionRevision" IS NULL OR "connectionRevision" IS DISTINCT FROM connection."updatedAt")
      THEN 'REVIEW' ELSE COALESCE("enrollmentStatus",'PENDING') END AS "enrollmentStatus","enrollmentIssue","sourceStage","sheet","archivedAt",
    "lastError","collectedAt","lastAttemptAt","nextAttemptAt","manualRefreshRequestedAt","projectionVersion", ${snapshot} AS "snapshot" ${full ? Prisma.sql`, "notes"` : Prisma.empty}
    FROM unnest(ARRAY[${Prisma.join(ids)}]::text[]) AS requested(id)
    LEFT JOIN "PilotAriveProjection" ON "pipelineId"=requested.id LEFT JOIN capacity ON TRUE
    LEFT JOIN "AriveIntegrationConfig" connection ON connection."id"='company'`;
  return new Map(rows.map((row) => [row.pipelineId, {
    ...row, enrollmentIssue: pilotReviewMessage(row.enrollmentIssue), lastError: pilotReviewMessage(row.lastError),
  }]));
}

// Older entries used one message for a rejected search, a verified detail
// read, and even a numeric probe after no exact search result was found.
// Until a fresh read distinguishes these, show the same uncertainty in the
// file and in aggregate coverage.
export function pilotReviewMessage(issue: string | null) {
  return issue === 'Previous branch check returned HTTP 403. Arive denied access to this file.'
    ? 'The previous branch check could not verify this file. Confirm its Arive loan number and branch visibility.'
    : issue;
}

export function summarizePilotCoverage(files: { id: string; sheet: string; archivedAt?: Date | null; loan: AriveLoanIdentity }[], projections: Map<string, Projection>, now: Date) {
  const counts = { eligible: 0, verified: 0, pending: 0, waiting: 0, inaccessible: 0, review: 0, excluded: 0,
    verifiedActive: 0, activeFresh: 0, verifiedQuiet: 0, quietFresh: 0, oldestDueSeconds: 0 };
  const sourcePipeline = { total: 0, verified: 0, pending: 0, review: 0, excluded: 0 };
  for (const file of files) {
    // A file moved to Fundings in Pilot still belongs in the coverage denominator
    // if staff see it in their active Pipeline.
    const inPipeline = file.sheet === 'PIPELINE' && !file.archivedAt;
    if (inPipeline) sourcePipeline.total++;
    const projection = projections.get(file.id);
    if (projection?.enrollmentStatus === 'EXCLUDED') {
      counts.excluded++;
      if (inPipeline) sourcePipeline.excluded++;
      continue;
    }
    counts.eligible++;
    if (projection && usablePilotProjection(file.loan, projection)) {
      counts.verified++;
      if (inPipeline) sourcePipeline.verified++;
      const age = +now - +projection.collectedAt!;
      if (projection.archivedAt || (projection.sheet ?? file.sheet) === 'FUNDING') {
        counts.verifiedQuiet++;
        if (age >= 0 && age <= 60 * 60_000) counts.quietFresh++;
      } else {
        counts.verifiedActive++;
        if (age >= 0 && age <= 60_000) counts.activeFresh++;
      }
      if (projection.nextAttemptAt && projection.nextAttemptAt < now)
        counts.oldestDueSeconds = Math.max(counts.oldestDueSeconds, Math.floor((+now - +projection.nextAttemptAt) / 1000));
    }
    else if (projection?.enrollmentStatus === 'REVIEW' || projection?.enrollmentStatus === 'VERIFIED') {
      if (inPipeline) sourcePipeline.review++;
      if (currentReviewEvidence(file.loan, projection) && isPilotAccessDenied(projection.enrollmentIssue)) counts.inaccessible++;
      else counts.review++;
    } else {
      if (inPipeline) sourcePipeline.pending++;
      if (projection?.pilotRefreshHold === 'COHORT_FULL') counts.waiting++;
      else counts.pending++;
    }
  }
  return { ...counts, sourcePipeline };
}

export async function readPilotCoverage(where: Prisma.ProcessingPipelineLoanWhereInput, now: Date) {
  const files = await prisma.processingPipelineLoan.findMany({
    where,
    select: { id: true, sheet: true, archivedAt: true, loan: { select: pilotIdentitySelect } },
  });
  const projections = await readPilotProjections(files.map(file => file.id), 'coverage');
  return summarizePilotCoverage(files, projections, now);
}

function scalar(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Prisma.Decimal.isDecimal(value)) return Number(value);
  return value;
}

/** Evaluate only the predicates generated by BISU's own pipeline/report filter builders, after projection. */
export function matchesPilotWhere(row: unknown, where: unknown): boolean {
  if (where === undefined) return true;
  if (where === null || typeof where !== 'object' || where instanceof Date) return scalar(row) === scalar(where);
  const actual = jsonRecord(row);
  return Object.entries(where).every(([field, target]) => {
    if (target === undefined || field === 'mode') return true;
    if (field === 'AND' || field === 'OR') {
      const entries = Array.isArray(target) ? target : [target];
      return field === 'AND'
        ? entries.every((item) => matchesPilotWhere(row, item))
        : entries.some((item) => matchesPilotWhere(row, item));
    }
    if (field === 'is' || field === 'equals') return matchesPilotWhere(row, target);
    if (field === 'not') return !matchesPilotWhere(row, target);
    if (field === 'in') return Array.isArray(target) && target.some((item) => scalar(row) === scalar(item));
    if (field === 'contains')
      return typeof row === 'string' && typeof target === 'string' && row.toLowerCase().includes(target.toLowerCase());
    if (['gte', 'gt', 'lte', 'lt'].includes(field)) {
      const left = scalar(row),
        right = scalar(target);
      if (typeof left !== 'number' || typeof right !== 'number') return false;
      return field === 'gte'
        ? left >= right
        : field === 'gt'
          ? left > right
          : field === 'lte'
            ? left <= right
            : left < right;
    }
    return Object.hasOwn(actual, field) && matchesPilotWhere(actual[field], target);
  });
}

/** Reauthorize the source set, then form the manifest using effective values before ordering and slicing.
 * The index is private to this call. No documents, application data or notes are loaded. */
export async function pilotReadIndex(
  actor: ProcessingPipelineScopeActor,
  where: Prisma.ProcessingPipelineLoanWhereInput,
) {
  // A single bucket is the common case. The broader candidate set also includes
  // loans routed into this bucket only in Pilot. Recheck the effective predicate below.
  const clauses = Array.isArray(where.AND) ? where.AND : [where];
  const bucket = clauses.find((part) => part.sheet !== undefined)?.sheet;
  const bucketScope: Prisma.ProcessingPipelineLoanWhereInput =
    typeof bucket === 'string' ? { OR: [{ sheet: bucket }, { pilotArive: { is: { sheet: bucket } } }] } : {};
  const rows = await prisma.processingPipelineLoan.findMany({
    where: { AND: [buildProcessingPipelineScopeWhere(actor), bucketScope] },
    include: {
      loan: {
        select: {
          ...pilotIdentitySelect,
          loanOfficerId: true,
          secondaryLoanOfficerId: true,
          visibilitySubmitterUserId: true,
          amount: true,
          program: true,
        },
      },
      juniorProcessor: { select: { id: true, name: true } },
      seniorProcessor: { select: { id: true, name: true } },
    },
  });
  const projections = await readPilotProjections(rows.map((row) => row.id));
  return rows
    .map((row) => {
      const projection = projections.get(row.id);
      const usable = usablePilotProjection(row.loan, projection);
      const ariveSync = usable
        ? {
            workerOwner: 'GENERALIZED',
            enrollmentStatus: 'VERIFIED',
            enabled: true,
            lastSuccessAt: projection!.collectedAt,
            sourceStage: projection!.sourceStage,
          }
        : null;
      return { ...effectivePilotRow(row, projection), ariveSync };
    })
    .filter((row) => matchesPilotWhere(row, where));
}
type IndexRow = Awaited<ReturnType<typeof pilotReadIndex>>[number];
export function orderPilotRows(rows: IndexRow[], key?: string, direction?: 'asc' | 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  const stageRank = Object.values(ProcessingPipelineStatus);
  return rows.sort((left, right) => {
    let diff: number;
    if (key === 'ariveStage') {
      const a = left.ariveSync?.sourceStage,
        b = right.ariveSync?.sourceStage;
      if (!!a !== !!b) return a ? -1 : 1;
      diff = (a || '').localeCompare(b || '') * factor;
    } else if (key === 'borrowerName' || key === 'loanNumber')
      diff = left.loan[key].localeCompare(right.loan[key]) * factor;
    else if (key === 'dateAssigned' || key === 'statusChangedAt')
      diff = (left[key].getTime() - right[key].getTime()) * factor;
    else
      diff =
        stageRank.indexOf(left.pipelineStatus) - stageRank.indexOf(right.pipelineStatus) ||
        left.statusChangedAt.getTime() - right.statusChangedAt.getTime() ||
        right.dateAssigned.getTime() - left.dateAssigned.getTime();
    return diff || left.id.localeCompare(right.id);
  });
}
