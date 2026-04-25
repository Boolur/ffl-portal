-- Allow LeadCampaignGroup and LeadUserTeam to store 1-3 accent colors.
-- The legacy `color` column is kept as a mirror of `colors[0]` so in-flight
-- reads during deploy can't crash on a missing column. New writes keep both
-- in sync; a future migration can drop `color` once nothing reads it.

ALTER TABLE "LeadCampaignGroup"
  ADD COLUMN IF NOT EXISTS "colors" TEXT[] NOT NULL DEFAULT ARRAY['blue']::TEXT[];

UPDATE "LeadCampaignGroup"
  SET "colors" = ARRAY["color"]::TEXT[];

ALTER TABLE "LeadUserTeam"
  ADD COLUMN IF NOT EXISTS "colors" TEXT[] NOT NULL DEFAULT ARRAY['blue']::TEXT[];

UPDATE "LeadUserTeam"
  SET "colors" = ARRAY["color"]::TEXT[];
