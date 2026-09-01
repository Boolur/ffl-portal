CREATE TABLE "PayrollSubmissionCompletion" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reopenedAt" TIMESTAMP(3),
  "reopenedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PayrollSubmissionCompletion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollSubmissionCompletion_userId_windowStart_windowEnd_key"
  ON "PayrollSubmissionCompletion"("userId", "windowStart", "windowEnd");

CREATE INDEX "PayrollSubmissionCompletion_windowStart_windowEnd_idx"
  ON "PayrollSubmissionCompletion"("windowStart", "windowEnd");

CREATE INDEX "PayrollSubmissionCompletion_reopenedById_idx"
  ON "PayrollSubmissionCompletion"("reopenedById");

ALTER TABLE "PayrollSubmissionCompletion"
  ADD CONSTRAINT "PayrollSubmissionCompletion_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollSubmissionCompletion"
  ADD CONSTRAINT "PayrollSubmissionCompletion_reopenedById_fkey"
  FOREIGN KEY ("reopenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
