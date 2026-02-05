-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "pipelineStageId" TEXT;

-- CreateTable
CREATE TABLE "ExternalUser" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadMailboxLead" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadMailboxLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineNote" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalUser_userId_idx" ON "ExternalUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalUser_provider_externalId_key" ON "ExternalUser"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadMailboxLead_leadId_key" ON "LeadMailboxLead"("leadId");

-- CreateIndex
CREATE INDEX "LeadMailboxLead_userId_receivedAt_idx" ON "LeadMailboxLead"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "PipelineStage_userId_order_idx" ON "PipelineStage"("userId", "order");

-- CreateIndex
CREATE INDEX "PipelineNote_loanId_createdAt_idx" ON "PipelineNote"("loanId", "createdAt");

-- CreateIndex
CREATE INDEX "Loan_loanOfficerId_pipelineStageId_idx" ON "Loan"("loanOfficerId", "pipelineStageId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_pipelineStageId_fkey" FOREIGN KEY ("pipelineStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalUser" ADD CONSTRAINT "ExternalUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMailboxLead" ADD CONSTRAINT "LeadMailboxLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadMailboxLead" ADD CONSTRAINT "LeadMailboxLead_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineNote" ADD CONSTRAINT "PipelineNote_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineNote" ADD CONSTRAINT "PipelineNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
