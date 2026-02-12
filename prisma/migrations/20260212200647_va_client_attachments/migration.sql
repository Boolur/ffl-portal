-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('SUBMIT_DISCLOSURES', 'SUBMIT_QC', 'LO_NEEDS_INFO', 'VA_TITLE', 'VA_HOI', 'VA_PAYOFF', 'VA_APPRAISAL');

-- CreateEnum
CREATE TYPE "TaskAttachmentPurpose" AS ENUM ('PROOF', 'STIP', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'VA_TITLE';
ALTER TYPE "UserRole" ADD VALUE 'VA_HOI';
ALTER TYPE "UserRole" ADD VALUE 'VA_PAYOFF';
ALTER TYPE "UserRole" ADD VALUE 'VA_APPRAISAL';

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "kind" "TaskKind";

-- CreateTable
CREATE TABLE "TaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "clientDocumentId" TEXT,
    "purpose" "TaskAttachmentPurpose" NOT NULL DEFAULT 'OTHER',
    "storagePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "leadId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "folder" TEXT,
    "tags" TEXT[],
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskAttachment_taskId_createdAt_idx" ON "TaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskAttachment_clientDocumentId_idx" ON "TaskAttachment"("clientDocumentId");

-- CreateIndex
CREATE INDEX "Client_ownerId_lastName_idx" ON "Client"("ownerId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ownerId_phone_key" ON "Client"("ownerId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Client_ownerId_leadId_key" ON "Client"("ownerId", "leadId");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_createdAt_idx" ON "ClientDocument"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Loan_clientId_idx" ON "Loan"("clientId");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_clientDocumentId_fkey" FOREIGN KEY ("clientDocumentId") REFERENCES "ClientDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
