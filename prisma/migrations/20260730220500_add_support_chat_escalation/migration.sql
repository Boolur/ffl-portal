-- AlterTable
ALTER TABLE "SupportConversation" ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SupportConversation_escalated_lastMessageAt_idx" ON "SupportConversation"("escalated", "lastMessageAt");
