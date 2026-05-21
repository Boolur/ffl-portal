-- CreateEnum
CREATE TYPE "PayrollCompRequestStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollLoanChannel" AS ENUM ('BROKER', 'NON_DELEGATED');

-- CreateEnum
CREATE TYPE "PayrollProcessingType" AS ENUM ('IN_HOUSE', 'CONTRACT', 'LENDER', 'OTHER');

-- CreateTable
CREATE TABLE "PayrollCompPlan" (
    "id" TEXT NOT NULL,
    "loanOfficerId" TEXT NOT NULL,
    "baseSplitPercent" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveEnd" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCompPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCompSplit" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "roleLabel" TEXT NOT NULL,
    "splitPercent" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "effectiveStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCompSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCompRequest" (
    "id" TEXT NOT NULL,
    "loanOfficerId" TEXT NOT NULL,
    "loanId" TEXT,
    "loanNumber" TEXT NOT NULL,
    "borrowerName" TEXT NOT NULL,
    "loanType" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "loanChannel" "PayrollLoanChannel" NOT NULL,
    "processingType" "PayrollProcessingType" NOT NULL,
    "expectedRevenue" DECIMAL(12,2) NOT NULL,
    "status" "PayrollCompRequestStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "submitterNotes" TEXT,
    "adminNotes" TEXT,
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCompRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCompRequestSplit" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "planId" TEXT,
    "recipientUserId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "roleLabel" TEXT NOT NULL,
    "splitPercent" DECIMAL(7,4) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCompRequestSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollCompPlan_loanOfficerId_active_idx" ON "PayrollCompPlan"("loanOfficerId", "active");

-- CreateIndex
CREATE INDEX "PayrollCompPlan_effectiveStart_effectiveEnd_idx" ON "PayrollCompPlan"("effectiveStart", "effectiveEnd");

-- CreateIndex
CREATE INDEX "PayrollCompSplit_planId_active_sortOrder_idx" ON "PayrollCompSplit"("planId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "PayrollCompSplit_recipientUserId_idx" ON "PayrollCompSplit"("recipientUserId");

-- CreateIndex
CREATE INDEX "PayrollCompRequest_loanOfficerId_submittedAt_idx" ON "PayrollCompRequest"("loanOfficerId", "submittedAt");

-- CreateIndex
CREATE INDEX "PayrollCompRequest_status_submittedAt_idx" ON "PayrollCompRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "PayrollCompRequest_paidAt_idx" ON "PayrollCompRequest"("paidAt");

-- CreateIndex
CREATE INDEX "PayrollCompRequest_loanNumber_idx" ON "PayrollCompRequest"("loanNumber");

-- CreateIndex
CREATE INDEX "PayrollCompRequest_loanId_idx" ON "PayrollCompRequest"("loanId");

-- CreateIndex
CREATE INDEX "PayrollCompRequestSplit_requestId_sortOrder_idx" ON "PayrollCompRequestSplit"("requestId", "sortOrder");

-- CreateIndex
CREATE INDEX "PayrollCompRequestSplit_recipientUserId_idx" ON "PayrollCompRequestSplit"("recipientUserId");

-- CreateIndex
CREATE INDEX "PayrollCompRequestSplit_planId_idx" ON "PayrollCompRequestSplit"("planId");

-- AddForeignKey
ALTER TABLE "PayrollCompPlan" ADD CONSTRAINT "PayrollCompPlan_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompSplit" ADD CONSTRAINT "PayrollCompSplit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayrollCompPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompSplit" ADD CONSTRAINT "PayrollCompSplit_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequest" ADD CONSTRAINT "PayrollCompRequest_loanOfficerId_fkey" FOREIGN KEY ("loanOfficerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequest" ADD CONSTRAINT "PayrollCompRequest_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequest" ADD CONSTRAINT "PayrollCompRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequest" ADD CONSTRAINT "PayrollCompRequest_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequestSplit" ADD CONSTRAINT "PayrollCompRequestSplit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PayrollCompRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequestSplit" ADD CONSTRAINT "PayrollCompRequestSplit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PayrollCompPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompRequestSplit" ADD CONSTRAINT "PayrollCompRequestSplit_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
