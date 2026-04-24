-- CreateTable
CREATE TABLE "LeadCampaignGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'blue',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCampaignGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCampaignGroup_name_key" ON "LeadCampaignGroup"("name");

-- CreateIndex
CREATE INDEX "LeadCampaignGroup_active_idx" ON "LeadCampaignGroup"("active");

-- AlterTable
ALTER TABLE "LeadCampaign" ADD COLUMN "groupId" TEXT;

-- CreateIndex
CREATE INDEX "LeadCampaign_groupId_idx" ON "LeadCampaign"("groupId");

-- AddForeignKey
ALTER TABLE "LeadCampaign" ADD CONSTRAINT "LeadCampaign_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "LeadCampaignGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
