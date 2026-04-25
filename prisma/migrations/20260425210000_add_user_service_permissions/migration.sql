-- CreateTable
CREATE TABLE "UserIntegrationServicePermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "canPush" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIntegrationServicePermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserIntegrationServicePermission_userId_serviceId_key" ON "UserIntegrationServicePermission"("userId", "serviceId");

-- CreateIndex
CREATE INDEX "UserIntegrationServicePermission_serviceId_idx" ON "UserIntegrationServicePermission"("serviceId");

-- AddForeignKey
ALTER TABLE "UserIntegrationServicePermission" ADD CONSTRAINT "UserIntegrationServicePermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIntegrationServicePermission" ADD CONSTRAINT "UserIntegrationServicePermission_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "IntegrationService"("id") ON DELETE CASCADE ON UPDATE CASCADE;
