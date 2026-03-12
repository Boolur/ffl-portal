-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loDisclosureSubmissionEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "loQcSubmissionEnabled" BOOLEAN NOT NULL DEFAULT true;
