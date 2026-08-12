ALTER TYPE "ProcessingPipelineStatus"
ADD VALUE 'ADVERSE_PENDING';

ALTER TYPE "ProcessingPipelineStatus"
ADD VALUE 'PENDING_APPROVAL';

ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "restructureNotes" TEXT;

UPDATE "ProcessingPipelineLoan"
SET
  "pipelineStatus" = 'SUSPENDED_RESTRUCTURE',
  "statusChangedAt" = CURRENT_TIMESTAMP
WHERE "sheet" = 'RESTRUCTURE'
  AND "pipelineStatus" <> 'SUSPENDED_RESTRUCTURE';
