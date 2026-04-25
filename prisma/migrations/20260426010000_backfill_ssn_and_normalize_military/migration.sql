-- Backfill Lead.ssn for historical rows + canonicalize Lead.isMilitary.
--
-- Context:
--   * The CSV importer (bulkCreateLeadsFromCsv / bulkCreateLeadsBatch) and
--     the direct vendor webhook both used to strip `ssn` from their insert
--     allow-lists. Admins still mapped the SSN column in the upload UI, so
--     the value only survived inside `rawPayload`. This migration lifts it
--     back onto the `ssn` column for every row where the value is still
--     sitting in the JSON blob.
--
--   * `isMilitary` was stored as whatever string the vendor sent (True,
--     true, Yes, yes, Y, 1, No, False, N, 0, etc.). Bonzo's native Veteran
--     field is boolean-strict in campaign conditionals, so we normalize
--     the historical values to the portal's canonical "Yes" / "No" to
--     match the new ingest-time behavior. Values we can't confidently
--     classify (typos, "maybe") are left untouched so admins can still
--     see what the vendor actually sent.
--
-- Safety:
--   * Only writes when the target column is NULL (SSN) or when the
--     normalized form differs from the stored value (isMilitary), so the
--     migration is idempotent.
--   * Leaves `rawPayload` untouched in every case so we never lose the
--     original vendor-provided value.

-- 1. Backfill SSN from rawPayload.ssn / rawPayload.social for any lead
--    that doesn't already have the column set.
UPDATE "Lead"
SET    "ssn" = COALESCE(
         NULLIF(TRIM("rawPayload"->>'ssn'), ''),
         NULLIF(TRIM("rawPayload"->>'social'), '')
       )
WHERE  "ssn" IS NULL
  AND  jsonb_typeof("rawPayload") = 'object'
  AND  (
         ("rawPayload" ? 'ssn'    AND TRIM("rawPayload"->>'ssn')    <> '')
      OR ("rawPayload" ? 'social' AND TRIM("rawPayload"->>'social') <> '')
       );

-- 2. Backfill leadCreated from rawPayload for historical rows. CSV /
--    webhook importers used to drop this too; re-using the JSON blob
--    lets historical imports display the vendor's original timestamp
--    instead of only the portal-side receivedAt.
UPDATE "Lead"
SET    "leadCreated" = COALESCE(
         NULLIF(TRIM("rawPayload"->>'leadCreated'),  ''),
         NULLIF(TRIM("rawPayload"->>'lead_created'), ''),
         NULLIF(TRIM("rawPayload"->>'created'),      '')
       )
WHERE  "leadCreated" IS NULL
  AND  jsonb_typeof("rawPayload") = 'object'
  AND  (
         ("rawPayload" ? 'leadCreated'  AND TRIM("rawPayload"->>'leadCreated')  <> '')
      OR ("rawPayload" ? 'lead_created' AND TRIM("rawPayload"->>'lead_created') <> '')
      OR ("rawPayload" ? 'created'      AND TRIM("rawPayload"->>'created')      <> '')
       );

-- 3. Canonicalize isMilitary to "Yes" / "No". Matches the accepted tokens
--    in src/lib/militaryFlag.ts so runtime-normalized and historically
--    stored values look the same.
UPDATE "Lead"
SET    "isMilitary" = 'Yes'
WHERE  "isMilitary" IS NOT NULL
  AND  "isMilitary" <> 'Yes'
  AND  LOWER(TRIM("isMilitary")) IN (
         'yes', 'y', 'true', 't', '1',
         'military', 'veteran', 'active',
         'retired', 'reserves', 'reserve', 'guard'
       );

UPDATE "Lead"
SET    "isMilitary" = 'No'
WHERE  "isMilitary" IS NOT NULL
  AND  "isMilitary" <> 'No'
  AND  LOWER(TRIM("isMilitary")) IN (
         'no', 'n', 'false', 'f', '0',
         'none', 'civilian', 'not military',
         'non-military', 'nonmilitary'
       );

-- Empty-string isMilitary (from LM substituting a blank source field)
-- should be stored as NULL so Bonzo's veteran mirror falls back cleanly
-- to vaStatus at push time instead of sending `"custom_veteran": ""`.
UPDATE "Lead"
SET    "isMilitary" = NULL
WHERE  "isMilitary" IS NOT NULL
  AND  TRIM("isMilitary") = '';
