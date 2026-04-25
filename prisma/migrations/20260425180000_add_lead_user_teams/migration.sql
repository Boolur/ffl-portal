-- CreateTable
CREATE TABLE "LeadUserTeam" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadUserTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadUserTeam_name_key" ON "LeadUserTeam"("name");

-- CreateIndex
CREATE INDEX "LeadUserTeam_active_idx" ON "LeadUserTeam"("active");

-- CreateTable
CREATE TABLE "LeadUserTeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadUserTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadUserTeamMember_teamId_userId_key" ON "LeadUserTeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "LeadUserTeamMember_userId_idx" ON "LeadUserTeamMember"("userId");

-- AddForeignKey
ALTER TABLE "LeadUserTeamMember" ADD CONSTRAINT "LeadUserTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "LeadUserTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadUserTeamMember" ADD CONSTRAINT "LeadUserTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
