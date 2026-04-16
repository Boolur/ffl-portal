ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'LOA';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationOutboxStatus') THEN
    CREATE TYPE "NotificationOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'RETRY', 'SENT', 'FAILED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationOutboxEventType') THEN
    CREATE TYPE "NotificationOutboxEventType" AS ENUM ('TASK_WORKFLOW', 'VA_FANOUT');
  END IF;
END $$;

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

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationOutbox_idempotencyKey_key" ON "NotificationOutbox"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_status_nextAttemptAt_createdAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationOutbox_eventType_status_idx" ON "NotificationOutbox"("eventType", "status");

CREATE INDEX IF NOT EXISTS "Task_assignedRole_dueDate_idx" ON "Task"("assignedRole", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_assignedUserId_dueDate_idx" ON "Task"("assignedUserId", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_kind_dueDate_idx" ON "Task"("kind", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_status_dueDate_idx" ON "Task"("status", "dueDate");
CREATE INDEX IF NOT EXISTS "Task_loanId_updatedAt_idx" ON "Task"("loanId", "updatedAt");

ALTER TABLE "Loan"
ADD COLUMN IF NOT EXISTS "secondaryLoanOfficerId" TEXT,
ADD COLUMN IF NOT EXISTS "visibilitySubmitterUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Loan_secondaryLoanOfficerId_fkey'
  ) THEN
    ALTER TABLE "Loan"
    ADD CONSTRAINT "Loan_secondaryLoanOfficerId_fkey"
    FOREIGN KEY ("secondaryLoanOfficerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Loan_visibilitySubmitterUserId_fkey'
  ) THEN
    ALTER TABLE "Loan"
    ADD CONSTRAINT "Loan_visibilitySubmitterUserId_fkey"
    FOREIGN KEY ("visibilitySubmitterUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Loan_secondaryLoanOfficerId_idx" ON "Loan"("secondaryLoanOfficerId");
CREATE INDEX IF NOT EXISTS "Loan_visibilitySubmitterUserId_idx" ON "Loan"("visibilitySubmitterUserId");
