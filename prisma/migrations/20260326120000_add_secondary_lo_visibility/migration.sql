-- Add shared LO visibility fields for primary/secondary/fallback submitter access.
ALTER TABLE "Loan"
ADD COLUMN IF NOT EXISTS "secondaryLoanOfficerId" TEXT;

ALTER TABLE "Loan"
ADD COLUMN IF NOT EXISTS "visibilitySubmitterUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Loan_secondaryLoanOfficerId_fkey'
  ) THEN
    ALTER TABLE "Loan"
    ADD CONSTRAINT "Loan_secondaryLoanOfficerId_fkey"
    FOREIGN KEY ("secondaryLoanOfficerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Loan_visibilitySubmitterUserId_fkey'
  ) THEN
    ALTER TABLE "Loan"
    ADD CONSTRAINT "Loan_visibilitySubmitterUserId_fkey"
    FOREIGN KEY ("visibilitySubmitterUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "Loan_secondaryLoanOfficerId_idx" ON "Loan"("secondaryLoanOfficerId");
CREATE INDEX IF NOT EXISTS "Loan_visibilitySubmitterUserId_idx" ON "Loan"("visibilitySubmitterUserId");
