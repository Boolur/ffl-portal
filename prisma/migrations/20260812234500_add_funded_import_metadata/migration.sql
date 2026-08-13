ALTER TABLE "PayrollCompRequest"
ADD COLUMN "leadSourceDetail" TEXT,
ADD COLUMN "fundedImportKey" TEXT,
ADD COLUMN "fundedImportMetadata" JSONB;

CREATE UNIQUE INDEX "PayrollCompRequest_fundedImportKey_key"
ON "PayrollCompRequest"("fundedImportKey");
