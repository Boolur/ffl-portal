CREATE TYPE "ProcessingPipelineSheet" AS ENUM ('PIPELINE', 'RESTRUCTURE', 'FUNDING');
CREATE TYPE "ProcessingPipelineStatus" AS ENUM (
  'SUBBED_TO_UW',
  'APPROVED_WITH_CONDITIONS',
  'RE_SUB',
  'CTC',
  'DOCS_OUT',
  'FUNDED',
  'SUSPENDED_RESTRUCTURE'
);
CREATE TYPE "ProcessingItemStatus" AS ENUM (
  'NOT_STARTED',
  'ORDERED',
  'RECEIVED',
  'NOT_APPLICABLE'
);

CREATE TABLE "ProcessingPipelineLoan" (
  "id" TEXT NOT NULL,
  "loanId" TEXT NOT NULL,
  "sourceTaskId" TEXT NOT NULL,
  "seniorProcessorId" TEXT,
  "juniorProcessorId" TEXT,
  "assignmentGroup" TEXT,
  "dateAssigned" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sheet" "ProcessingPipelineSheet" NOT NULL DEFAULT 'PIPELINE',
  "pipelineStatus" "ProcessingPipelineStatus" NOT NULL DEFAULT 'SUBBED_TO_UW',
  "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "titleStatus" "ProcessingItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "payoffStatus" "ProcessingItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "hoiStatus" "ProcessingItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "appraisalNeeded" BOOLEAN,
  "appraisalNotes" TEXT,
  "appraisalOrderedAt" TIMESTAMP(3),
  "appraisalBackAt" TIMESTAMP(3),
  "missingItemsCurrentStatus" TEXT,
  "extraNotes" TEXT,
  "rateLock" BOOLEAN,
  "loanType" TEXT,
  "propertyState" TEXT,
  "lender" TEXT,
  "projectedRevenue" DECIMAL(12,2),
  "finalRevenue" DECIMAL(12,2),
  "fundedAt" TIMESTAMP(3),
  "firstPaymentAt" TIMESTAMP(3),
  "sixthPaymentAt" TIMESTAMP(3),
  "movedAt" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingPipelineLoan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessingPipelineLoan_loanId_key" ON "ProcessingPipelineLoan"("loanId");
CREATE UNIQUE INDEX "ProcessingPipelineLoan_sourceTaskId_key" ON "ProcessingPipelineLoan"("sourceTaskId");
CREATE INDEX "ProcessingPipelineLoan_sheet_statusChangedAt_idx" ON "ProcessingPipelineLoan"("sheet", "statusChangedAt");
CREATE INDEX "ProcessingPipelineLoan_seniorProcessorId_sheet_idx" ON "ProcessingPipelineLoan"("seniorProcessorId", "sheet");
CREATE INDEX "ProcessingPipelineLoan_juniorProcessorId_idx" ON "ProcessingPipelineLoan"("juniorProcessorId");
CREATE INDEX "ProcessingPipelineLoan_assignmentGroup_idx" ON "ProcessingPipelineLoan"("assignmentGroup");

ALTER TABLE "ProcessingPipelineLoan"
  ADD CONSTRAINT "ProcessingPipelineLoan_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingPipelineLoan"
  ADD CONSTRAINT "ProcessingPipelineLoan_sourceTaskId_fkey"
  FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingPipelineLoan"
  ADD CONSTRAINT "ProcessingPipelineLoan_seniorProcessorId_fkey"
  FOREIGN KEY ("seniorProcessorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProcessingPipelineLoan"
  ADD CONSTRAINT "ProcessingPipelineLoan_juniorProcessorId_fkey"
  FOREIGN KEY ("juniorProcessorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ProcessingPipelineLoan" (
  "id",
  "loanId",
  "sourceTaskId",
  "seniorProcessorId",
  "juniorProcessorId",
  "assignmentGroup",
  "dateAssigned",
  "appraisalNeeded",
  "appraisalNotes",
  "loanType",
  "propertyState",
  "lender",
  "projectedRevenue",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  t."loanId",
  t."id",
  (
    SELECT u."id"
    FROM "User" u
    WHERE u."active" = true
      AND ('PROCESSOR_SR' = ANY(u."roles") OR u."role" = 'PROCESSOR_SR')
      AND t."submissionData"->>'processingAssignmentGroup' = ANY(u."processingAssignmentGroups")
    ORDER BY u."name", u."id"
    LIMIT 1
  ),
  t."assignedUserId",
  t."submissionData"->>'processingAssignmentGroup',
  COALESCE(t."completedAt", t."updatedAt", CURRENT_TIMESTAMP),
  CASE
    WHEN lower(COALESCE(t."submissionData"->>'appraisalNeeded', '')) IN ('true', 'yes', '1') THEN true
    WHEN lower(COALESCE(t."submissionData"->>'appraisalNeeded', '')) IN ('false', 'no', '0') THEN false
    ELSE NULL
  END,
  NULLIF(t."submissionData"->>'appraisalNotes', ''),
  COALESCE(NULLIF(t."submissionData"->>'loanType', ''), l."program"),
  NULLIF(COALESCE(t."submissionData"->>'propertyState', t."submissionData"->>'state'), ''),
  NULLIF(t."submissionData"->>'lender', ''),
  CASE
    WHEN COALESCE(t."submissionData"->>'projectedRevenue', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (t."submissionData"->>'projectedRevenue')::DECIMAL(12,2)
    ELSE NULL
  END,
  COALESCE(t."completedAt", t."updatedAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "Task" t
JOIN "Loan" l ON l."id" = t."loanId"
WHERE t."kind" = 'SUBMIT_PROCESSING'
  AND t."status" = 'COMPLETED'
ON CONFLICT ("loanId") DO NOTHING;
