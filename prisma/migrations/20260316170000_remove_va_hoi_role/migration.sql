-- Re-map legacy VA_HOI assignments before removing enum value.
ALTER TYPE "UserRole" RENAME TO "UserRole_old";

CREATE TYPE "UserRole" AS ENUM (
  'ADMIN',
  'MANAGER',
  'LOAN_OFFICER',
  'DISCLOSURE_SPECIALIST',
  'VA',
  'VA_TITLE',
  'VA_PAYOFF',
  'VA_APPRAISAL',
  'QC',
  'PROCESSOR_JR',
  'PROCESSOR_SR'
);

ALTER TABLE "User"
ALTER COLUMN "role" TYPE "UserRole"
USING (
  CASE
    WHEN "role"::text = 'VA_HOI' THEN 'PROCESSOR_JR'::"UserRole"
    ELSE "role"::text::"UserRole"
  END
);

ALTER TABLE "User"
ALTER COLUMN "roles" TYPE "UserRole"[]
USING (
  COALESCE(
    ARRAY(
      SELECT
        CASE
          WHEN role_value::text = 'VA_HOI' THEN 'PROCESSOR_JR'
          ELSE role_value::text
        END::"UserRole"
      FROM unnest("roles") AS role_value
    ),
    ARRAY[]::"UserRole"[]
  )
);

ALTER TABLE "Task"
ALTER COLUMN "assignedRole" TYPE "UserRole"
USING (
  CASE
    WHEN "assignedRole" IS NULL THEN NULL
    WHEN "assignedRole"::text = 'VA_HOI' THEN 'PROCESSOR_JR'::"UserRole"
    ELSE "assignedRole"::text::"UserRole"
  END
);

DROP TYPE "UserRole_old";
