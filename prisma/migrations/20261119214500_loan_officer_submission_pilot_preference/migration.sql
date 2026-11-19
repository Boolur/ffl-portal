-- A leadership-role preference must not put the user's Loan Officer dashboard into Pilot.
ALTER TABLE "User" ADD COLUMN "loanOfficerPilotEnabled" BOOLEAN NOT NULL DEFAULT false;
