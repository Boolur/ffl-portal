ALTER TYPE "PayrollLeadSource" ADD VALUE 'DIGITAL_MAILER';

ALTER TABLE "PayrollCompRequest"
  ADD COLUMN "mailerCampaign" TEXT,
  ADD COLUMN "loanOfficerSplitPercentOverride" DECIMAL(7,4);
