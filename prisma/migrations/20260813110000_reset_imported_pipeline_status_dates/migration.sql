UPDATE "ProcessingPipelineLoan" pipeline
SET "statusChangedAt" = backfill."importedAt"
FROM (
  SELECT
    audit."loanId",
    MAX(audit."createdAt") AS "importedAt"
  FROM "AuditLog" audit
  WHERE audit."action" = 'PROCESSING_PIPELINE_BACKFILL_CREATED'
  GROUP BY audit."loanId"
) backfill
WHERE pipeline."loanId" = backfill."loanId";
