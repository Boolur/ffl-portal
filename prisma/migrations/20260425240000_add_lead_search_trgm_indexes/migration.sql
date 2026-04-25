-- Speed up the "Search by name, email, or phone..." bar on the Leads
-- screen. The server turns every typed query into `ILIKE '%q%'` across
-- a set of identity columns; without trigram indexes, Postgres can only
-- answer that with a sequential scan of the whole Lead table (100k+
-- rows in production). GIN + gin_trgm_ops lets the planner use an
-- index even for middle-wildcard matches, dropping search time from
-- tens of seconds to well under a second.
--
-- pg_trgm is available on Supabase / Postgres 13+ out of the box;
-- IF NOT EXISTS keeps the migration safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Lead_firstName_trgm_idx"       ON "Lead" USING gin ("firstName"       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_lastName_trgm_idx"        ON "Lead" USING gin ("lastName"        gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_email_trgm_idx"           ON "Lead" USING gin ("email"           gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_phone_trgm_idx"           ON "Lead" USING gin ("phone"           gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_homePhone_trgm_idx"       ON "Lead" USING gin ("homePhone"       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_coFirstName_trgm_idx"     ON "Lead" USING gin ("coFirstName"     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_coLastName_trgm_idx"      ON "Lead" USING gin ("coLastName"      gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_coEmail_trgm_idx"         ON "Lead" USING gin ("coEmail"         gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_coPhone_trgm_idx"         ON "Lead" USING gin ("coPhone"         gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_propertyAddress_trgm_idx" ON "Lead" USING gin ("propertyAddress" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_propertyCity_trgm_idx"    ON "Lead" USING gin ("propertyCity"    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_propertyZip_trgm_idx"     ON "Lead" USING gin ("propertyZip"     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_vendorLeadId_trgm_idx"    ON "Lead" USING gin ("vendorLeadId"    gin_trgm_ops);
