CREATE TABLE "ArivePipelineSync" (
  "id" TEXT NOT NULL,
  "pipelineId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledById" TEXT NOT NULL,
  "ariveLoanId" TEXT NOT NULL,
  "ariveGuid" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "fieldSources" JSONB NOT NULL DEFAULT '{}',
  "conflicts" JSONB NOT NULL DEFAULT '[]',
  "issues" JSONB NOT NULL DEFAULT '[]',
  "snapshotHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ArivePipelineSync_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ArivePipelineSync_pipelineId_key" ON "ArivePipelineSync"("pipelineId");
CREATE INDEX "ArivePipelineSync_enabled_nextAttemptAt_idx" ON "ArivePipelineSync"("enabled", "nextAttemptAt");
ALTER TABLE "ArivePipelineSync" ADD CONSTRAINT "ArivePipelineSync_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ProcessingPipelineLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
