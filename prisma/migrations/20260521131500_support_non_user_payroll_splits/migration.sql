-- AlterTable
ALTER TABLE "PayrollCompSplit"
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "recipientEmail" TEXT,
ALTER COLUMN "recipientUserId" DROP NOT NULL;

-- Backfill named snapshots for existing user-based split rows.
UPDATE "PayrollCompSplit" split
SET "recipientName" = "User"."name",
    "recipientEmail" = "User"."email"
FROM "User"
WHERE split."recipientUserId" = "User"."id"
  AND split."recipientName" IS NULL;

-- DropForeignKey
ALTER TABLE "PayrollCompSplit" DROP CONSTRAINT "PayrollCompSplit_recipientUserId_fkey";

-- AddForeignKey
ALTER TABLE "PayrollCompSplit" ADD CONSTRAINT "PayrollCompSplit_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
