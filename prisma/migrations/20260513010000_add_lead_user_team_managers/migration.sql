CREATE TABLE "LeadUserTeamManager" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadUserTeamManager_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadUserTeamManager_teamId_userId_key" ON "LeadUserTeamManager"("teamId", "userId");
CREATE INDEX "LeadUserTeamManager_userId_idx" ON "LeadUserTeamManager"("userId");

ALTER TABLE "LeadUserTeamManager" ADD CONSTRAINT "LeadUserTeamManager_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "LeadUserTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadUserTeamManager" ADD CONSTRAINT "LeadUserTeamManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
