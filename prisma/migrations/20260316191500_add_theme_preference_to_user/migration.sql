-- CreateEnum
CREATE TYPE "ThemePreference" AS ENUM ('LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "themePreference" "ThemePreference" NOT NULL DEFAULT 'LIGHT';
