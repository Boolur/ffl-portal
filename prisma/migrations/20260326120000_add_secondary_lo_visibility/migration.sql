-- Add shared LO visibility fields for primary/secondary/fallback submitter access.
ALTER TABLE "Loan"
ADD COLUMN "secondaryLoanOfficerId" TEXT,
ADD COLUMN "visibilitySubmitterUserId" TEXT;

ALTER TABLE "Loan"
ADD CONSTRAINT "Loan_secondaryLoanOfficerId_fkey"
FOREIGN KEY ("secondaryLoanOfficerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Loan"
ADD CONSTRAINT "Loan_visibilitySubmitterUserId_fkey"
FOREIGN KEY ("visibilitySubmitterUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Loan_secondaryLoanOfficerId_idx" ON "Loan"("secondaryLoanOfficerId");
CREATE INDEX "Loan_visibilitySubmitterUserId_idx" ON "Loan"("visibilitySubmitterUserId");
