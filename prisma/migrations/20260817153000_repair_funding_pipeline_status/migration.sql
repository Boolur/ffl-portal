-- Repair rows created by older move logic that set the Funding sheet and
-- funded date without completing the corresponding status transition.
UPDATE "ProcessingPipelineLoan"
SET
  "pipelineStatus" = 'FUNDED',
  "statusChangedAt" = COALESCE("movedAt", "fundedAt", "statusChangedAt"),
  "rateLockRequestedAt" = NULL,
  "rateLockRequestedById" = NULL,
  "version" = "version" + 1
WHERE "sheet" = 'FUNDING'
  AND "pipelineStatus" <> 'FUNDED';

ALTER TABLE "ProcessingPipelineLoan"
ADD CONSTRAINT "ProcessingPipelineLoan_funding_status_consistency"
CHECK (
  ("sheet" = 'FUNDING' AND "pipelineStatus" = 'FUNDED')
  OR
  ("sheet" <> 'FUNDING' AND "pipelineStatus" <> 'FUNDED')
);
