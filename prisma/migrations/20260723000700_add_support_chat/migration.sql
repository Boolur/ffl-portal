-- CreateEnum
CREATE TYPE "SupportDesk" AS ENUM ('SCENARIO', 'PRICING', 'HELP');

-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'WAITING_ON_STAFF', 'WAITING_ON_REQUESTER', 'RESOLVED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "NotificationOutboxEventType" ADD VALUE 'SUPPORT_CHAT';

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "desk" "SupportDesk" NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "loanId" TEXT,
    "lender" TEXT,
    "loanType" TEXT,
    "propertyState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "staffOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversationReadState" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportConversationReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportDeskAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "desk" "SupportDesk" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lenders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "loanTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportDeskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportConversation_requesterId_lastMessageAt_idx" ON "SupportConversation"("requesterId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_assignedUserId_lastMessageAt_idx" ON "SupportConversation"("assignedUserId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_desk_status_lastMessageAt_idx" ON "SupportConversation"("desk", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_loanId_idx" ON "SupportConversation"("loanId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMessage_authorId_createdAt_idx" ON "SupportMessage"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversationReadState_conversationId_userId_key" ON "SupportConversationReadState"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "SupportConversationReadState_userId_lastReadAt_idx" ON "SupportConversationReadState"("userId", "lastReadAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportDeskAssignment_userId_desk_key" ON "SupportDeskAssignment"("userId", "desk");

-- CreateIndex
CREATE INDEX "SupportDeskAssignment_desk_active_sortOrder_idx" ON "SupportDeskAssignment"("desk", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "SupportDeskAssignment_userId_idx" ON "SupportDeskAssignment"("userId");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversationReadState" ADD CONSTRAINT "SupportConversationReadState_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversationReadState" ADD CONSTRAINT "SupportConversationReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportDeskAssignment" ADD CONSTRAINT "SupportDeskAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
