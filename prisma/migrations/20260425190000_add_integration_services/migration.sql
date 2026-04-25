-- CreateTable
CREATE TABLE "IntegrationService" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationService_slug_key" ON "IntegrationService"("slug");

-- CreateIndex
CREATE INDEX "IntegrationService_active_idx" ON "IntegrationService"("active");

-- Seed the Bonzo service row so the feature works out of the box.
INSERT INTO "IntegrationService" (
    "id", "slug", "name", "description", "type", "active", "config", "createdAt", "updatedAt"
) VALUES (
    gen_random_uuid(),
    'bonzo',
    'Bonzo',
    'Forward leads to each assigned LO''s Bonzo account.',
    'bonzo',
    true,
    '{}'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
) ON CONFLICT ("slug") DO NOTHING;
