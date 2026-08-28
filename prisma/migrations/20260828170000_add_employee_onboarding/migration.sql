ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ONBOARDING';
ALTER TYPE "NotificationOutboxEventType" ADD VALUE IF NOT EXISTS 'ONBOARDING';

CREATE TYPE "OnboardingStatus" AS ENUM (
  'INVITED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW',
  'CHANGES_REQUESTED', 'APPROVED', 'COMPLETED', 'CANCELLED'
);
CREATE TYPE "OnboardingItemStatus" AS ENUM (
  'NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED',
  'CHANGES_REQUESTED', 'COMPLETED', 'NOT_APPLICABLE'
);
CREATE TYPE "OnboardingItemOwner" AS ENUM ('NEW_HIRE', 'MANAGEMENT', 'INTERNAL');
CREATE TYPE "OnboardingFieldType" AS ENUM ('CHECKBOX', 'TEXT', 'DATE', 'FILE', 'SELECT');
CREATE TYPE "OnboardingDocumentVisibility" AS ENUM ('NEW_HIRE', 'INTERNAL', 'BOTH');
CREATE TYPE "OnboardingDocumentStatus" AS ENUM (
  'REQUESTED', 'UPLOADED', 'PENDING_SIGNATURE', 'SIGNED',
  'APPROVED', 'REJECTED', 'VOIDED'
);

CREATE TABLE "OnboardingTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingTemplateItem" (
  "id" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "owner" "OnboardingItemOwner" NOT NULL,
  "fieldType" "OnboardingFieldType" NOT NULL DEFAULT 'CHECKBOX',
  "fieldKey" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "options" JSONB,
  CONSTRAINT "OnboardingTemplateItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingCase" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "inviteId" TEXT,
  "templateId" TEXT NOT NULL,
  "candidateName" TEXT NOT NULL,
  "personalEmail" TEXT NOT NULL,
  "status" "OnboardingStatus" NOT NULL DEFAULT 'INVITED',
  "targetRoles" "UserRole"[] NOT NULL DEFAULT ARRAY[]::"UserRole"[],
  "ownerId" TEXT,
  "createdById" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingProfile" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "firstName" TEXT,
  "lastName" TEXT,
  "preferredFirstName" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "mobilePhone" TEXT,
  "homeAddress" TEXT,
  "offerDate" TIMESTAMP(3),
  "startDate" TIMESTAMP(3),
  "jobTitle" TEXT,
  "managerName" TEXT,
  "basePay" TEXT,
  "compensationPlan" TEXT,
  "location" TEXT,
  "department" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingItem" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "templateItemId" TEXT,
  "category" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "owner" "OnboardingItemOwner" NOT NULL,
  "assignedUserId" TEXT,
  "status" "OnboardingItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "required" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL,
  "dueAt" TIMESTAMP(3),
  "response" JSONB,
  "candidateNote" TEXT,
  "internalNote" TEXT,
  "submittedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingDocument" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "itemId" TEXT,
  "uploadedById" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "storagePath" TEXT,
  "visibility" "OnboardingDocumentVisibility" NOT NULL DEFAULT 'BOTH',
  "status" "OnboardingDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
  "documentType" TEXT,
  "templateVersion" TEXT,
  "signatureProvider" TEXT,
  "externalEnvelopeId" TEXT,
  "signerStatus" JSONB,
  "signedStoragePath" TEXT,
  "webhookUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OnboardingDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingEvent" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OnboardingESignEvent" (
  "id" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "documentId" TEXT,
  "envelopeId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnboardingESignEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingTemplate_name_version_key" ON "OnboardingTemplate"("name", "version");
CREATE UNIQUE INDEX "OnboardingTemplateItem_templateId_sortOrder_key" ON "OnboardingTemplateItem"("templateId", "sortOrder");
CREATE INDEX "OnboardingTemplateItem_templateId_category_sortOrder_idx" ON "OnboardingTemplateItem"("templateId", "category", "sortOrder");
CREATE UNIQUE INDEX "OnboardingCase_userId_key" ON "OnboardingCase"("userId");
CREATE UNIQUE INDEX "OnboardingCase_inviteId_key" ON "OnboardingCase"("inviteId");
CREATE INDEX "OnboardingCase_status_updatedAt_idx" ON "OnboardingCase"("status", "updatedAt");
CREATE INDEX "OnboardingCase_ownerId_status_idx" ON "OnboardingCase"("ownerId", "status");
CREATE INDEX "OnboardingCase_personalEmail_idx" ON "OnboardingCase"("personalEmail");
CREATE UNIQUE INDEX "OnboardingProfile_caseId_key" ON "OnboardingProfile"("caseId");
CREATE UNIQUE INDEX "OnboardingItem_caseId_sortOrder_key" ON "OnboardingItem"("caseId", "sortOrder");
CREATE INDEX "OnboardingItem_caseId_owner_status_idx" ON "OnboardingItem"("caseId", "owner", "status");
CREATE INDEX "OnboardingItem_assignedUserId_status_idx" ON "OnboardingItem"("assignedUserId", "status");
CREATE INDEX "OnboardingDocument_caseId_createdAt_idx" ON "OnboardingDocument"("caseId", "createdAt");
CREATE INDEX "OnboardingDocument_itemId_idx" ON "OnboardingDocument"("itemId");
CREATE UNIQUE INDEX "OnboardingDocument_externalEnvelopeId_key" ON "OnboardingDocument"("externalEnvelopeId");
CREATE INDEX "OnboardingEvent_caseId_createdAt_idx" ON "OnboardingEvent"("caseId", "createdAt");
CREATE INDEX "OnboardingEvent_actorId_createdAt_idx" ON "OnboardingEvent"("actorId", "createdAt");
CREATE UNIQUE INDEX "OnboardingESignEvent_providerEventId_key" ON "OnboardingESignEvent"("providerEventId");
CREATE INDEX "OnboardingESignEvent_documentId_processedAt_idx" ON "OnboardingESignEvent"("documentId", "processedAt");
CREATE INDEX "OnboardingESignEvent_envelopeId_idx" ON "OnboardingESignEvent"("envelopeId");
CREATE UNIQUE INDEX "OnboardingCase_open_personalEmail_key"
  ON "OnboardingCase"(LOWER("personalEmail"))
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED');

ALTER TABLE "OnboardingTemplateItem"
  ADD CONSTRAINT "OnboardingTemplateItem_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OnboardingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingCase"
  ADD CONSTRAINT "OnboardingCase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingCase"
  ADD CONSTRAINT "OnboardingCase_inviteId_fkey"
  FOREIGN KEY ("inviteId") REFERENCES "InviteToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingCase"
  ADD CONSTRAINT "OnboardingCase_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "OnboardingTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OnboardingProfile"
  ADD CONSTRAINT "OnboardingProfile_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "OnboardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingItem"
  ADD CONSTRAINT "OnboardingItem_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "OnboardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingItem"
  ADD CONSTRAINT "OnboardingItem_templateItemId_fkey"
  FOREIGN KEY ("templateItemId") REFERENCES "OnboardingTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingDocument"
  ADD CONSTRAINT "OnboardingDocument_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "OnboardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingDocument"
  ADD CONSTRAINT "OnboardingDocument_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "OnboardingItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OnboardingEvent"
  ADD CONSTRAINT "OnboardingEvent_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "OnboardingCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OnboardingESignEvent"
  ADD CONSTRAINT "OnboardingESignEvent_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "OnboardingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
