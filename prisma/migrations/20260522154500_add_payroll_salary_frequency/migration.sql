-- CreateEnum
CREATE TYPE "PayrollSalaryFrequency" AS ENUM ('SEMI_MONTHLY', 'MONTHLY', 'ANNUALLY');

-- AlterTable
ALTER TABLE "PayrollCompPlan"
ADD COLUMN "salaryFrequency" "PayrollSalaryFrequency" NOT NULL DEFAULT 'SEMI_MONTHLY';
