-- CreateEnum
CREATE TYPE "SupportAttachmentPurpose" AS ENUM ('MISMO', 'OTHER');

-- CreateTable
CREATE TABLE "SupportAttachment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "purpose" "SupportAttachmentPurpose" NOT NULL DEFAULT 'OTHER',
    "storagePath" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportAttachment_conversationId_createdAt_idx" ON "SupportAttachment"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAttachment_uploadedById_createdAt_idx" ON "SupportAttachment"("uploadedById", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAttachment" ADD CONSTRAINT "SupportAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
