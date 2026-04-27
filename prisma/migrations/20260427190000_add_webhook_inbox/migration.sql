-- CreateEnum
CREATE TYPE "WebhookInboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "WebhookInboxEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "vendorSlug" TEXT,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "headers" JSONB NOT NULL,
    "body" JSONB NOT NULL,
    "status" "WebhookInboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "leadId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookInboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookInboxEvent_status_receivedAt_idx" ON "WebhookInboxEvent"("status", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookInboxEvent_source_vendorSlug_receivedAt_idx" ON "WebhookInboxEvent"("source", "vendorSlug", "receivedAt" DESC);

-- CreateIndex
CREATE INDEX "WebhookInboxEvent_leadId_idx" ON "WebhookInboxEvent"("leadId");
