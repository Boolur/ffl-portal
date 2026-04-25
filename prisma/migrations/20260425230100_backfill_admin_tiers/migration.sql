-- Backfill every existing ADMIN row to ADMIN_III. Runs in a separate
-- migration because Postgres forbids using a newly added enum value in the
-- same transaction that declared it (see 20260425230000_add_admin_tiers).

UPDATE "User" SET "role" = 'ADMIN_III' WHERE "role" = 'ADMIN';

UPDATE "User"
SET "roles" = array_replace("roles", 'ADMIN'::"UserRole", 'ADMIN_III'::"UserRole")
WHERE 'ADMIN' = ANY("roles");

UPDATE "InviteToken" SET "role" = 'ADMIN_III' WHERE "role" = 'ADMIN';

UPDATE "Task" SET "assignedRole" = 'ADMIN_III' WHERE "assignedRole" = 'ADMIN';
