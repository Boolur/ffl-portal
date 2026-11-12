-- AlterTable
ALTER TABLE "ArivePipelineSync" ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "collectedSnapshot" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "connectionId" TEXT NOT NULL DEFAULT 'company',
ADD COLUMN     "enrollmentIssue" TEXT,
ADD COLUMN     "enrollmentStatus" TEXT NOT NULL DEFAULT 'VERIFIED',
ADD COLUMN     "everFunded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manualRefreshRequestedAt" TIMESTAMP(3),
ADD COLUMN     "operatorPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "routingProvenance" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sourceStage" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedOriginatorEmail" TEXT,
ADD COLUMN     "workerGeneration" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workerOwner" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pilotViewEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AriveRolloutControl" (
    "id" TEXT NOT NULL DEFAULT 'company',
    "collectionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "applicationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enrollmentEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cohortLimit" INTEGER DEFAULT 10,
    "enabledById" TEXT,
    "enrollmentCursor" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AriveRolloutControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AriveLoanNotes" (
    "pipelineId" TEXT NOT NULL,
    "notes" JSONB NOT NULL DEFAULT '[]',
    "contentHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AriveLoanNotes_pkey" PRIMARY KEY ("pipelineId")
);

-- CreateTable
CREATE TABLE "ArivePracticeLoan" (
    "ariveLoanId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ariveGuid" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArivePracticeLoan_pkey" PRIMARY KEY ("ariveLoanId")
);

-- CreateTable
CREATE TABLE "AriveConnectionRuntime" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "providerRequestLimit" INTEGER,
    "providerWindowSeconds" INTEGER,
    "quotaConfirmedAt" TIMESTAMP(3),
    "quotaKeyFingerprint" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "encryptedAccessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "credentialFingerprint" TEXT,
    "refreshLeaseToken" TEXT,
    "refreshLeaseUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AriveConnectionRuntime_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AriveTransportRequest" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "statusCode" INTEGER,

    CONSTRAINT "AriveTransportRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotPracticeTask" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceTaskId" TEXT,
    "sourceLoanId" TEXT,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SUBMIT_PROCESSING',
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "draft" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotPracticeTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotPracticePackage" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "items" JSONB NOT NULL,

    CONSTRAINT "PilotPracticePackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotPracticeFile" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT,
    "sourceAttachmentId" TEXT,
    "sourceDocumentTaskId" TEXT,
    "sourceDocumentFileId" TEXT,
    "uploaded" BOOLEAN NOT NULL DEFAULT false,
    "retired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotPracticeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotPracticeEvent" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotPracticeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PilotPracticeNotification" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PilotPracticeNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AriveTransportRequest_connectionId_keyFingerprint_startedAt_idx" ON "AriveTransportRequest"("connectionId", "keyFingerprint", "startedAt");

-- CreateIndex
CREATE INDEX "AriveTransportRequest_connectionId_startedAt_idx" ON "AriveTransportRequest"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "AriveTransportRequest_connectionId_finishedAt_leaseUntil_idx" ON "AriveTransportRequest"("connectionId", "finishedAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "PilotPracticeTask_ownerId_updatedAt_idx" ON "PilotPracticeTask"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "PilotPracticeTask_sourceTaskId_idx" ON "PilotPracticeTask"("sourceTaskId");

-- CreateIndex
CREATE INDEX "PilotPracticeTask_sourceLoanId_idx" ON "PilotPracticeTask"("sourceLoanId");

-- CreateIndex
CREATE UNIQUE INDEX "PilotPracticePackage_taskId_key" ON "PilotPracticePackage"("taskId");

-- CreateIndex
CREATE INDEX "PilotPracticeFile_packageId_itemId_idx" ON "PilotPracticeFile"("packageId", "itemId");

-- CreateIndex
CREATE INDEX "PilotPracticeEvent_taskId_createdAt_idx" ON "PilotPracticeEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "PilotPracticeNotification_taskId_createdAt_idx" ON "PilotPracticeNotification"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ArivePipelineSync_workerOwner_enabled_nextAttemptAt_idx" ON "ArivePipelineSync"("workerOwner", "enabled", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ArivePipelineSync_connectionId_enrollmentStatus_idx" ON "ArivePipelineSync"("connectionId", "enrollmentStatus");

-- CreateIndex
CREATE INDEX "ArivePipelineSync_sourceStage_idx" ON "ArivePipelineSync"("sourceStage");

-- AddForeignKey
ALTER TABLE "AriveLoanNotes" ADD CONSTRAINT "AriveLoanNotes_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "ProcessingPipelineLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AriveTransportRequest" ADD CONSTRAINT "AriveTransportRequest_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AriveConnectionRuntime"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotPracticePackage" ADD CONSTRAINT "PilotPracticePackage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PilotPracticeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotPracticeFile" ADD CONSTRAINT "PilotPracticeFile_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PilotPracticePackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotPracticeEvent" ADD CONSTRAINT "PilotPracticeEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PilotPracticeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotPracticeNotification" ADD CONSTRAINT "PilotPracticeNotification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "PilotPracticeTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
