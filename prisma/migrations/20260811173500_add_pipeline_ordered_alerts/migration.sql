ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "payoffOrderedAt" TIMESTAMP(3),
ADD COLUMN "hoiOrderedAt" TIMESTAMP(3);

UPDATE "ProcessingPipelineLoan"
SET "payoffOrderedAt" = "updatedAt"
WHERE "payoffStatus" = 'ORDERED';

UPDATE "ProcessingPipelineLoan"
SET "hoiOrderedAt" = "updatedAt"
WHERE "hoiStatus" = 'ORDERED';
