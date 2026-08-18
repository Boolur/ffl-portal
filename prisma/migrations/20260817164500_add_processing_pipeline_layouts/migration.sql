CREATE TABLE "ProcessingPipelineLayout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProcessingPipelineLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcessingPipelineLayout_userId_nameKey_key"
ON "ProcessingPipelineLayout"("userId", "nameKey");

CREATE INDEX "ProcessingPipelineLayout_userId_sortOrder_idx"
ON "ProcessingPipelineLayout"("userId", "sortOrder");

CREATE INDEX "ProcessingPipelineLayout_userId_isActive_idx"
ON "ProcessingPipelineLayout"("userId", "isActive");

ALTER TABLE "ProcessingPipelineLayout"
ADD CONSTRAINT "ProcessingPipelineLayout_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
