CREATE TYPE "PayrollReimbursementTarget" AS ENUM ('SELF', 'MANAGER');

ALTER TABLE "PayrollCompRequest"
  ADD COLUMN "reimbursementTarget" "PayrollReimbursementTarget" NOT NULL DEFAULT 'SELF',
  ADD COLUMN "processingFee" DECIMAL(12,2);
