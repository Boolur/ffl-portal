-- CreateEnum (idempotent for environments where enum already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationOutboxStatus') THEN
    CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED');
  END IF;
END
$$;

-- CreateEnum (idempotent for environments where enum already exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationOutboxEventType') THEN
    CREATE TYPE "NotificationOutboxEventType" AS ENUM ('TASK_WORKFLOW', 'VA_FANOUT');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "NotificationOutbox" (
    "id" TEXT NOT NULL,
    "eventType" "NotificationOutboxEventType" NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_idempotencyKey_key" ON "NotificationOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_createdAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NotificationOutbox_eventType_status_idx" ON "NotificationOutbox"("eventType", "status");
