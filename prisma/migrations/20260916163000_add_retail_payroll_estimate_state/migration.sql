ALTER TABLE "PayrollCompRequest"
  ADD COLUMN "estimatedCompAmount" DECIMAL(12,2),
  ADD COLUMN "managerCalculationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "managerCalculationCompletedAt" TIMESTAMP(3),
  ADD COLUMN "managerCalculationCompletedById" TEXT;

CREATE INDEX "PayrollCompRequest_managerCalculationCompletedById_idx"
  ON "PayrollCompRequest"("managerCalculationCompletedById");

ALTER TABLE "PayrollCompRequest"
  ADD CONSTRAINT "PayrollCompRequest_managerCalculationCompletedById_fkey"
  FOREIGN KEY ("managerCalculationCompletedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
