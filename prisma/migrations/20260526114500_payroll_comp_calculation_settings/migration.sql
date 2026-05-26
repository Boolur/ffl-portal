-- Payroll compensation calculation worksheet and settings database

CREATE TYPE "PayrollSettingValueType" AS ENUM ('MONEY', 'NUMBER', 'TEXT', 'BOOLEAN');
CREATE TYPE "PayrollFeeRuleKind" AS ENUM ('WIRE_FEE', 'UNDERWRITING_FEE', 'ORIGINATION_FEE', 'ONE_DAY_INTEREST', 'LENDER_CREDIT', 'OTHER');

ALTER TABLE "PayrollCompPlan" ADD COLUMN "requiresOriginationFeeWarning" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PayrollCompRequest" ADD COLUMN "brokerComp" DECIMAL(12,2),
ADD COLUMN "sectionAComp" DECIMAL(12,2),
ADD COLUMN "yspAmount" DECIMAL(12,2),
ADD COLUMN "toleranceCure" DECIMAL(12,2),
ADD COLUMN "oneDayInterest" DECIMAL(12,2),
ADD COLUMN "wireFee" DECIMAL(12,2),
ADD COLUMN "underwritingFee" DECIMAL(12,2),
ADD COLUMN "lenderCredit" DECIMAL(12,2),
ADD COLUMN "originationFee" DECIMAL(12,2),
ADD COLUMN "appraisalAddBack" DECIMAL(12,2),
ADD COLUMN "creditAddBack" DECIMAL(12,2),
ADD COLUMN "voeAddBack" DECIMAL(12,2),
ADD COLUMN "termiteAddBack" DECIMAL(12,2),
ADD COLUMN "appraisalReinspectionAddBack" DECIMAL(12,2),
ADD COLUMN "waterTestAddBack" DECIMAL(12,2),
ADD COLUMN "loanAmountPriorToFees" DECIMAL(12,2),
ADD COLUMN "recessionDate" TIMESTAMP(3),
ADD COLUMN "figureNftyAttachmentName" TEXT,
ADD COLUMN "figureNftyAttachmentUrl" TEXT,
ADD COLUMN "grossCompAmount" DECIMAL(12,2),
ADD COLUMN "preSplitAddBackTotal" DECIMAL(12,2),
ADD COLUMN "preSplitDeductionTotal" DECIMAL(12,2),
ADD COLUMN "splitBasisAmount" DECIMAL(12,2),
ADD COLUMN "postSplitAddBackTotal" DECIMAL(12,2),
ADD COLUMN "netCompAmount" DECIMAL(12,2),
ADD COLUMN "calculationSnapshot" JSONB;

CREATE TABLE "PayrollSetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "valueType" "PayrollSettingValueType" NOT NULL DEFAULT 'TEXT',
  "value" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollLenderFeeRule" (
  "id" TEXT NOT NULL,
  "lender" TEXT NOT NULL,
  "loanChannel" "PayrollLoanChannel",
  "feeKind" "PayrollFeeRuleKind" NOT NULL,
  "label" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollLenderFeeRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollLenderRequirement" (
  "id" TEXT NOT NULL,
  "lender" TEXT NOT NULL,
  "requiresLoanAmountPriorToFees" BOOLEAN NOT NULL DEFAULT false,
  "requiresFundedDetailsAttachment" BOOLEAN NOT NULL DEFAULT false,
  "requiresRecessionDate" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollLenderRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollUserSetting" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requiresOriginationFeeWarning" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollUserSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollSetting_key_key" ON "PayrollSetting"("key");
CREATE UNIQUE INDEX "PayrollLenderFeeRule_lender_loanChannel_feeKind_key" ON "PayrollLenderFeeRule"("lender", "loanChannel", "feeKind");
CREATE INDEX "PayrollLenderFeeRule_lender_active_idx" ON "PayrollLenderFeeRule"("lender", "active");
CREATE INDEX "PayrollLenderFeeRule_loanChannel_active_idx" ON "PayrollLenderFeeRule"("loanChannel", "active");
CREATE UNIQUE INDEX "PayrollLenderRequirement_lender_key" ON "PayrollLenderRequirement"("lender");
CREATE UNIQUE INDEX "PayrollUserSetting_userId_key" ON "PayrollUserSetting"("userId");

ALTER TABLE "PayrollUserSetting" ADD CONSTRAINT "PayrollUserSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
