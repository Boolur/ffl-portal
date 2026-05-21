-- CreateEnum
CREATE TYPE "PayrollUserClassification" AS ENUM ('BROKER', 'RETAIL', 'SUPPORT_STAFF');

-- CreateEnum
CREATE TYPE "PayrollCompPlanType" AS ENUM ('BROKER', 'RETAIL');

-- CreateEnum
CREATE TYPE "PayrollLeadSource" AS ENUM ('LEAD_BUY', 'MAILER', 'WARM_TRANSFER', 'REFERRAL', 'RETURN_CLIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "PayrollLeadProvidedBy" AS ENUM ('SELF_SOURCED', 'COMPANY_PROVIDED', 'BRANCH_PROVIDED');

-- AlterTable
ALTER TABLE "PayrollCompPlan"
ADD COLUMN "userClassification" "PayrollUserClassification" NOT NULL DEFAULT 'BROKER',
ADD COLUMN "planType" "PayrollCompPlanType" NOT NULL DEFAULT 'BROKER';

-- AlterTable
ALTER TABLE "PayrollCompRequest"
ADD COLUMN "leadSource" "PayrollLeadSource" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "leadProvidedBy" "PayrollLeadProvidedBy" NOT NULL DEFAULT 'SELF_SOURCED',
ADD COLUMN "appliedPlanType" "PayrollCompPlanType" NOT NULL DEFAULT 'BROKER';

-- CreateIndex
CREATE INDEX "PayrollCompPlan_loanOfficerId_planType_active_idx" ON "PayrollCompPlan"("loanOfficerId", "planType", "active");
