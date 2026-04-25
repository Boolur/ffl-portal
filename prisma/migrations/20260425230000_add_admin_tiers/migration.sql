-- Add three tiered admin roles to the UserRole enum and backfill every row
-- that currently uses ADMIN to the super-admin tier (ADMIN_III). The legacy
-- ADMIN value is intentionally left in the enum because Postgres cannot DROP
-- an enum value without rebuilding the type; the application layer will
-- treat any stray ADMIN row as ADMIN_III.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN_I';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN_II';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'ADMIN_III';
