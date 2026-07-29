-- CreateEnum
CREATE TYPE "PendingStpDispositionReason" AS ENUM ('CANCELLED', 'DNQ', 'GHOSTED', 'WAITING_FOR_MARKET_IMPROVEMENTS', 'OTHER');

-- CreateTable
CREATE TABLE "PendingStpDisposition" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "plusOneTaskId" TEXT NOT NULL,
    "ariveLoanNumber" TEXT,
    "loanOfficerId" TEXT NOT NULL,
    "actionedById" TEXT NOT NULL,
    "disposition" "PendingStpDispositionReason" NOT NULL,
    "note" TEXT,
    "actionedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reopenedByProcessingTaskId" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingStpDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingStpDisposition_loanId_idx" ON "PendingStpDisposition"("loanId");

-- CreateIndex
CREATE INDEX "PendingStpDisposition_plusOneTaskId_idx" ON "PendingStpDisposition"("plusOneTaskId");

-- CreateIndex
CREATE INDEX "PendingStpDisposition_loanOfficerId_actionedAt_idx" ON "PendingStpDisposition"("loanOfficerId", "actionedAt");

-- CreateIndex
CREATE INDEX "PendingStpDisposition_actionedAt_idx" ON "PendingStpDisposition"("actionedAt");

-- CreateIndex
CREATE INDEX "PendingStpDisposition_ariveLoanNumber_idx" ON "PendingStpDisposition"("ariveLoanNumber");

-- CreateIndex
CREATE INDEX "PendingStpDisposition_reopenedAt_idx" ON "PendingStpDisposition"("reopenedAt");

-- AddForeignKey
ALTER TABLE "PendingStpDisposition" ADD CONSTRAINT "PendingStpDisposition_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingStpDisposition" ADD CONSTRAINT "PendingStpDisposition_plusOneTaskId_fkey" FOREIGN KEY ("plusOneTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingStpDisposition" ADD CONSTRAINT "PendingStpDisposition_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingStpDisposition" ADD CONSTRAINT "PendingStpDisposition_actionedById_fkey" FOREIGN KEY ("actionedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingStpDisposition" ADD CONSTRAINT "PendingStpDisposition_reopenedByProcessingTaskId_fkey" FOREIGN KEY ("reopenedByProcessingTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
