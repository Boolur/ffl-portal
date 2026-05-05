INSERT INTO "User" (
  "id",
  "email",
  "name",
  "role",
  "roles",
  "active",
  "createdAt",
  "updatedAt"
)
VALUES
  (
    'jr-processor-alison-omoto',
    'alison.omoto@ffl.local',
    'Alison Omoto',
    'PROCESSOR_JR',
    ARRAY['PROCESSOR_JR']::"UserRole"[],
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'jr-processor-rachael-woolrigdge',
    'rachael.woolrigdge@ffl.local',
    'Rachael Woolrigdge',
    'PROCESSOR_JR',
    ARRAY['PROCESSOR_JR']::"UserRole"[],
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("email") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "role" = 'PROCESSOR_JR',
  "roles" = CASE
    WHEN 'PROCESSOR_JR'::"UserRole" = ANY("User"."roles") THEN "User"."roles"
    ELSE array_append("User"."roles", 'PROCESSOR_JR'::"UserRole")
  END,
  "active" = true,
  "updatedAt" = CURRENT_TIMESTAMP;
