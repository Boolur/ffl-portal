-- Performance indexes for the Lead list / pagination paths. The CRM and
-- LO "My Leads" pages sort by receivedAt DESC and page with large skip
-- values; without these covering indexes, Postgres ends up doing a full
-- sort of the 100k+ row set on every page change. CREATE INDEX IF NOT
-- EXISTS is used so re-running against environments where someone may
-- have added them by hand stays idempotent.

CREATE INDEX IF NOT EXISTS "Lead_status_receivedAt_idx"
  ON "Lead" ("status", "receivedAt" DESC);

CREATE INDEX IF NOT EXISTS "Lead_assignedUserId_receivedAt_idx"
  ON "Lead" ("assignedUserId", "receivedAt" DESC);

CREATE INDEX IF NOT EXISTS "Lead_campaignId_receivedAt_idx"
  ON "Lead" ("campaignId", "receivedAt" DESC);

CREATE INDEX IF NOT EXISTS "Lead_source_idx"
  ON "Lead" ("source");
