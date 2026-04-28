-- Adds a new IntegrationServiceMethod value for the fixed-template
-- Broker Launch Notification email. The seed row that uses this value
-- lives in the follow-up migration 20260428010100_seed_broker_launch_
-- email_service -- they are split because some Postgres versions
-- refuse to USE a newly-added enum value inside the same transaction
-- that declared it. Supabase (PG15) permits both forms, but keeping
-- them separate guarantees the migration works on every Postgres the
-- project may ever run against.
ALTER TYPE "IntegrationServiceMethod" ADD VALUE IF NOT EXISTS 'EMAIL_BROKER_LAUNCH';
