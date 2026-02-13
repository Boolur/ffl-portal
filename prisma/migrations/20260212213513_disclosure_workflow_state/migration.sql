-- CreateEnum
CREATE TYPE "DisclosureDecisionReason" AS ENUM ('APPROVE_INITIAL_DISCLOSURES', 'MISSING_ITEMS', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskWorkflowState" AS ENUM ('NONE', 'WAITING_ON_LO', 'WAITING_ON_LO_APPROVAL', 'READY_TO_COMPLETE');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "disclosureReason" "DisclosureDecisionReason",
ADD COLUMN     "loanOfficerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "parentTaskId" TEXT,
ADD COLUMN     "submissionData" JSONB,
ADD COLUMN     "workflowState" "TaskWorkflowState" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "Task_parentTaskId_idx" ON "Task"("parentTaskId");

-- CreateIndex
CREATE INDEX "Task_workflowState_idx" ON "Task"("workflowState");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
