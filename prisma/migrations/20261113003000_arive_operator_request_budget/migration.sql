-- Separate an operator-authorized ceiling from a provider-confirmed allowance.
-- Existing configurations keep their prior provider-confirmed behavior.
ALTER TABLE "AriveConnectionRuntime"
  ADD COLUMN "allowanceSource" TEXT NOT NULL DEFAULT 'PROVIDER_CONFIRMED',
  ADD COLUMN "operatorRequestLimit" INTEGER,
  ADD COLUMN "operatorAuthorizedAt" TIMESTAMP(3),
  ADD COLUMN "operatorAuthorizedById" TEXT;
