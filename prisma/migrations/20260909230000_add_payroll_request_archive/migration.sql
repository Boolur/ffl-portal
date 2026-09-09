ALTER TABLE "PayrollCompRequest"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedById" TEXT;

CREATE INDEX "PayrollCompRequest_archivedAt_idx"
  ON "PayrollCompRequest"("archivedAt");

CREATE INDEX "PayrollCompRequest_archivedById_idx"
  ON "PayrollCompRequest"("archivedById");

ALTER TABLE "PayrollCompRequest"
  ADD CONSTRAINT "PayrollCompRequest_archivedById_fkey"
  FOREIGN KEY ("archivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
