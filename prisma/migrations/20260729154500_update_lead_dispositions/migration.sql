-- Replace the original CRM lead statuses with the dispositions used by the
-- pipeline workflow. Existing values are mapped forward before the old enum is
-- removed so lead rows remain valid throughout the migration.
ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";

CREATE TYPE "LeadStatus" AS ENUM (
  'NEW',
  'HOT',
  'COLD',
  'DNQ',
  'SUBMITTED_PLUS_ONE',
  'SUBMITTED_DISCLOSURES',
  'SUBMITTED_PROCESSING',
  'UNASSIGNED'
);

ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Lead"
  ALTER COLUMN "status" TYPE "LeadStatus"
  USING (
    CASE "status"::text
      WHEN 'NEW' THEN 'NEW'
      WHEN 'CONTACTED' THEN 'HOT'
      WHEN 'WORKING' THEN 'HOT'
      WHEN 'CONVERTED' THEN 'SUBMITTED_PLUS_ONE'
      WHEN 'DEAD' THEN 'DNQ'
      WHEN 'RETURNED' THEN 'COLD'
      WHEN 'UNASSIGNED' THEN 'UNASSIGNED'
      ELSE 'NEW'
    END
  )::"LeadStatus";

ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'UNASSIGNED';

UPDATE "LeadCampaign"
SET "defaultLeadStatus" = CASE "defaultLeadStatus"
  WHEN 'CONTACTED' THEN 'HOT'
  WHEN 'WORKING' THEN 'HOT'
  WHEN 'CONVERTED' THEN 'SUBMITTED_PLUS_ONE'
  WHEN 'DEAD' THEN 'DNQ'
  WHEN 'RETURNED' THEN 'COLD'
  WHEN 'UNASSIGNED' THEN 'UNASSIGNED'
  ELSE 'NEW'
END;

UPDATE "IntegrationService"
SET "triggerStatus" = CASE "triggerStatus"
  WHEN 'CONTACTED' THEN 'HOT'
  WHEN 'WORKING' THEN 'HOT'
  WHEN 'CONVERTED' THEN 'SUBMITTED_PLUS_ONE'
  WHEN 'DEAD' THEN 'DNQ'
  WHEN 'RETURNED' THEN 'COLD'
  ELSE "triggerStatus"
END
WHERE "triggerStatus" IS NOT NULL;

DROP TYPE "LeadStatus_old";
