CREATE TABLE "OnboardingFileDeletionJob" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "storagePaths" TEXT[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OnboardingFileDeletionJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OnboardingFileDeletionJob_createdAt_idx"
ON "OnboardingFileDeletionJob"("createdAt");
