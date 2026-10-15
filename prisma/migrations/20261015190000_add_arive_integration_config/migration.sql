CREATE TABLE "AriveIntegrationConfig" (
  "id" TEXT NOT NULL,
  "encryptedCredentials" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AriveIntegrationConfig_pkey" PRIMARY KEY ("id")
);
