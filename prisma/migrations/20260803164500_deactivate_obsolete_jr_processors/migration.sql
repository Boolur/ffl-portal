-- These seeded placeholder accounts were retired. Preserve their historical
-- notifications while ensuring both existing and newly-created environments
-- leave the accounts disabled.
UPDATE "User"
SET
  "active" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'jr-processor-alison-omoto',
  'jr-processor-rachael-woolrigdge'
);
