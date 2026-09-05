ALTER TABLE "LoginAudit"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "country" TEXT;

CREATE INDEX "LoginAudit_ipAddress_createdAt_idx"
  ON "LoginAudit"("ipAddress", "createdAt");
