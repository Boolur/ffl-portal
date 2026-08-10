ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "cdSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cdWarningStartsAt" TIMESTAMP(3),
ADD COLUMN "rateLockExpiresAt" TIMESTAMP(3),
ADD COLUMN "rateLockConfirmedAt" TIMESTAMP(3),
ADD COLUMN "approvedWithConditionsAt" TIMESTAMP(3);

UPDATE "ProcessingPipelineLoan"
SET "rateLock" = false
WHERE "rateLock" IS NULL;

UPDATE "ProcessingPipelineLoan"
SET "approvedWithConditionsAt" = "statusChangedAt"
WHERE "pipelineStatus" = 'APPROVED_WITH_CONDITIONS';

ALTER TABLE "ProcessingPipelineLoan"
ALTER COLUMN "rateLock" SET DEFAULT false,
ALTER COLUMN "rateLock" SET NOT NULL;
