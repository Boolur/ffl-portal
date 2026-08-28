ALTER TABLE "OnboardingProfile"
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postalCode" TEXT;

UPDATE "OnboardingProfile"
SET "addressLine1" = "homeAddress"
WHERE "homeAddress" IS NOT NULL;

-- Bridge old and new application instances during the rolling deployment.
-- A legacy write is preserved in line 1 and intentionally clears the remaining
-- structured fields so the new wizard asks the candidate to confirm them.
CREATE OR REPLACE FUNCTION "sync_legacy_onboarding_address"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."homeAddress" IS NOT NULL AND NEW."addressLine1" IS NULL THEN
    NEW."addressLine1" := NEW."homeAddress";
  ELSIF
    TG_OP = 'UPDATE'
    AND NEW."homeAddress" IS DISTINCT FROM OLD."homeAddress"
    AND NEW."addressLine1" IS NOT DISTINCT FROM OLD."addressLine1"
    AND NEW."addressLine2" IS NOT DISTINCT FROM OLD."addressLine2"
    AND NEW."city" IS NOT DISTINCT FROM OLD."city"
    AND NEW."state" IS NOT DISTINCT FROM OLD."state"
    AND NEW."postalCode" IS NOT DISTINCT FROM OLD."postalCode"
  THEN
    NEW."addressLine1" := NEW."homeAddress";
    NEW."addressLine2" := NULL;
    NEW."city" := NULL;
    NEW."state" := NULL;
    NEW."postalCode" := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OnboardingProfile_legacy_address_sync"
BEFORE INSERT OR UPDATE ON "OnboardingProfile"
FOR EACH ROW
EXECUTE FUNCTION "sync_legacy_onboarding_address"();

UPDATE "OnboardingItem" AS item
SET
  "status" = 'IN_PROGRESS',
  "completedAt" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "OnboardingTemplateItem" AS template_item, "OnboardingCase" AS onboarding_case
WHERE
  item."templateItemId" = template_item."id"
  AND item."caseId" = onboarding_case."id"
  AND template_item."fieldKey" = 'homeAddress'
  AND item."status" = 'COMPLETED'
  AND onboarding_case."status" IN ('INVITED', 'IN_PROGRESS', 'CHANGES_REQUESTED');

-- Keep the legacy column during the rolling deployment so instances running the
-- previous application version continue to read successfully. New code writes
-- a compatibility value; remove the trigger, function, and column in a later
-- contract-only migration.
