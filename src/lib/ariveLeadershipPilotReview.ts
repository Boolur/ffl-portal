import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { DiagnosticSource } from './ariveDiagnosticSource';
import { stableAriveValue } from './ariveRollout';

export type PriorDiagnostic = {
  pipelineId: string;
  loanId: string;
  number: string;
  sourceHash: string;
  outcome: string;
  searchStatus: string | null;
  detailStatus: string | null;
  probeStatus: string | null;
};
type SavedEnrollment = {
  ariveLoanId: string;
  enrollmentStatus: string;
  enrollmentIssue: string | null;
  updatedAt: Date;
};

export async function priorPilotDiagnostics(tx: Prisma.TransactionClient, ids: string[], revision: Date) {
  if (!ids.length) return [];
  // Select only outcomes from recent, completed checks using this exact branch
  // connection revision. Identity evidence, provider bodies and names stay in the audit.
  return tx.$queryRaw<PriorDiagnostic[]>`
    WITH recent AS (
      SELECT "createdAt", details::jsonb AS run FROM "AuditLog"
      WHERE action='ARIVE_ACTIVE_PIPELINE_DIAGNOSTIC' AND "createdAt">=NOW()-INTERVAL '14 days'
      ORDER BY "createdAt" DESC LIMIT 8
    )
    SELECT DISTINCT ON (r->>'pipelineId') r->>'pipelineId' AS "pipelineId", c->>'loanId' AS "loanId",
      c->>'loanNumber' AS number,c->>'sourceHash' AS "sourceHash",r->>'outcome' AS outcome,
      r->>'searchHttpStatus' AS "searchStatus",r->>'detailHttpStatus' AS "detailStatus",
      r#>>'{evidence,numericProbe,httpStatus}' AS "probeStatus"
    FROM recent CROSS JOIN LATERAL jsonb_array_elements(run->'results') r
    JOIN LATERAL jsonb_array_elements(run->'cohort') c ON c->>'pipelineId'=r->>'pipelineId'
    WHERE run->>'status'='COMPLETE' AND run->>'credentialRevision'=${revision.toISOString()}
      AND r->>'pipelineId' IN (${Prisma.join(ids)})
    ORDER BY r->>'pipelineId',recent."createdAt" DESC`;
}

export function previousPilotReview(
  source: DiagnosticSource,
  canonical: SavedEnrollment | null,
  prior: PriorDiagnostic | undefined,
  revision: Date,
) {
  if (prior) {
    // A stale or successful newer diagnostic supersedes earlier enrollment
    // errors. A successful diagnostic still requires a fresh full Pilot read.
    const digest = createHash('sha256').update(stableAriveValue(source)).digest('hex');
    if (prior.loanId !== source.loanId || prior.number !== source.loan.loanNumber || prior.sourceHash !== digest)
      return null;
    if (prior.outcome === 'MATCHED' || prior.outcome === 'SOURCE_CHANGED') return null;
    if ([prior.searchStatus, prior.detailStatus, prior.probeStatus].includes('403'))
      return 'Previous branch check returned HTTP 403. Arive denied access to this file.';
    const labels: Record<string, string> = {
      INVALID_LOAN_NUMBER: 'Previous branch check found an invalid numeric loan number.',
      DUPLICATE_PORTAL_NUMBER: 'Previous branch check found a duplicate portal number.',
      NO_API_MATCH: 'Previous branch search found no exact loan number.',
      AMBIGUOUS_API_MATCH: 'Previous branch search returned ambiguous matches.',
      IDENTITY_MISMATCH: 'Previous branch check found a borrower, originator or permanent ID mismatch.',
      INVALID_RESPONSE: 'Previous branch check returned incomplete identity data.',
    };
    return labels[prior.outcome] ?? null;
  }
  if (
    canonical?.enrollmentStatus !== 'REVIEW' ||
    canonical.ariveLoanId !== source.loan.loanNumber ||
    canonical.updatedAt < revision
  )
    return null;
  const issue = canonical.enrollmentIssue ?? '';
  if (/HTTP 403/i.test(issue)) return 'Previous enrollment received HTTP 403 from Arive.';
  if (/zero loans|none had the exact/i.test(issue)) return 'Previous enrollment found no exact loan number.';
  if (/no confirmed numeric/i.test(issue)) return 'Previous enrollment found an invalid numeric loan number.';
  if (/does not (exactly )?match|does not match the verified portal/i.test(issue))
    return 'Previous enrollment found a loan identity mismatch.';
  return 'Previously flagged for enrollment review. A fresh branch check is required.';
}
