-- Re-map legacy VA_HOI assignments before removing enum value.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'MANAGER',
  'LOAN_OFFICER',
  'LOA',
  'DISCLOSURE_SPECIALIST',
  'VA',
  'VA_TITLE',
  'VA_PAYOFF',
  'VA_APPRAISAL',
  'QC',
  'PROCESSOR_JR',
  'PROCESSOR_SR'
);

-- Convert enum-backed columns to text/text[] first so we can normalize values
-- without unsupported subquery transforms in ALTER ... USING.
ALTER TABLE "User"
ALTER COLUMN "role" TYPE TEXT
USING ("role"::TEXT);

ALTER TABLE "User"
ALTER COLUMN "roles" TYPE TEXT[]
USING ("roles"::TEXT[]);

ALTER TABLE "Task"
ALTER COLUMN "assignedRole" TYPE TEXT
USING ("assignedRole"::TEXT);

-- Normalize legacy enum values.
UPDATE "User"
SET "role" = 'PROCESSOR_JR'
WHERE "role" = 'VA_HOI';

UPDATE "User"
SET "roles" = array_replace("roles", 'VA_HOI', 'PROCESSOR_JR')
WHERE "roles" IS NOT NULL
  AND "roles" @> ARRAY['VA_HOI'];

UPDATE "Task"
SET "assignedRole" = 'PROCESSOR_JR'
WHERE "assignedRole" = 'VA_HOI';

-- Cast normalized values to the new enum.
ALTER TABLE "User"
ALTER COLUMN "role" TYPE "UserRole"
USING ("role"::"UserRole");

ALTER TABLE "User"
ALTER COLUMN "roles" TYPE "UserRole"[]
USING ("roles"::"UserRole"[]);

ALTER TABLE "Task"
ALTER COLUMN "assignedRole" TYPE "UserRole"
USING (
  CASE
    WHEN "assignedRole" IS NULL THEN NULL
    ELSE "assignedRole"::"UserRole"
  END
);

DROP TYPE "UserRole_old";
