ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "rateLockRequestedAt" TIMESTAMP(3),
ADD COLUMN "rateLockRequestedById" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedById" TEXT;

CREATE INDEX "ProcessingPipelineLoan_rateLockRequestedAt_idx"
ON "ProcessingPipelineLoan"("rateLockRequestedAt");

CREATE INDEX "ProcessingPipelineLoan_archivedAt_idx"
ON "ProcessingPipelineLoan"("archivedAt");
