-- CreateEnum
CREATE TYPE "PayrollSplitPayType" AS ENUM ('PERCENT', 'FLAT', 'BOTH');

-- AlterTable
ALTER TABLE "PayrollCompSplit"
ADD COLUMN "payType" "PayrollSplitPayType" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN "flatAmount" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "PayrollCompRequestSplit"
ADD COLUMN "payType" "PayrollSplitPayType" NOT NULL DEFAULT 'PERCENT',
ADD COLUMN "flatAmount" DECIMAL(12,2);
