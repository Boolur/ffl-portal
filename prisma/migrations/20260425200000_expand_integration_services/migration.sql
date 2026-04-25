-- Enum types for the expanded service builder
CREATE TYPE "IntegrationServiceKind" AS ENUM ('CLIENT', 'SERVER');

CREATE TYPE "IntegrationServiceTrigger" AS ENUM (
    'MANUAL',
    'ON_RECEIVE',
    'ON_ASSIGN',
    'ON_STATUS_CHANGE',
    'DELAY_AFTER_RECEIVE',
    'DELAY_AFTER_ASSIGN'
);

CREATE TYPE "IntegrationServiceMethod" AS ENUM (
    'GET',
    'POST_TEXT',
    'POST_FORM',
    'POST_JSON',
    'POST_XML',
    'POST_XML_TEXT',
    'POST_XML_SOAP',
    'PUT_JSON'
);

CREATE TYPE "IntegrationServiceScope" AS ENUM ('ANY', 'SPECIFIC');

CREATE TYPE "ServiceDispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- Extend IntegrationService with the Lead Mailbox-parity columns
ALTER TABLE "IntegrationService"
    ADD COLUMN     "kind" "IntegrationServiceKind" NOT NULL DEFAULT 'CLIENT',
    ADD COLUMN     "statusTrigger" "IntegrationServiceTrigger" NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN     "triggerStatus" TEXT,
    ADD COLUMN     "triggerDay" INTEGER,
    ADD COLUMN     "triggerDelayMinutes" INTEGER,
    ADD COLUMN     "method" "IntegrationServiceMethod" NOT NULL DEFAULT 'POST_JSON',
    ADD COLUMN     "urlTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN     "bodyTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN     "headersTemplate" TEXT NOT NULL DEFAULT '',
    ADD COLUMN     "userScope" "IntegrationServiceScope" NOT NULL DEFAULT 'ANY',
    ADD COLUMN     "userIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN     "campaignScope" "IntegrationServiceScope" NOT NULL DEFAULT 'ANY',
    ADD COLUMN     "campaignIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN     "excludeSelected" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "successString" TEXT,
    ADD COLUMN     "failNotifyEmail" TEXT,
    ADD COLUMN     "dateOverride" TEXT,
    ADD COLUMN     "captureFields" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN     "requiresBrandNew" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "requiresNotBrandNew" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "requiresAssignedUser" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "requiresOAuth" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     "allowManualSend" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN     "oauthConfig" JSONB;

CREATE INDEX "IntegrationService_statusTrigger_active_idx"
    ON "IntegrationService"("statusTrigger", "active");

-- IntegrationServiceCredentialField
CREATE TABLE "IntegrationServiceCredentialField" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "placeholder" TEXT,
    "helpText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationServiceCredentialField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntegrationServiceCredentialField_serviceId_key_key"
    ON "IntegrationServiceCredentialField"("serviceId", "key");
CREATE INDEX "IntegrationServiceCredentialField_serviceId_idx"
    ON "IntegrationServiceCredentialField"("serviceId");

ALTER TABLE "IntegrationServiceCredentialField"
    ADD CONSTRAINT "IntegrationServiceCredentialField_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "IntegrationService"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- UserIntegrationCredential
CREATE TABLE "UserIntegrationCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserIntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserIntegrationCredential_userId_serviceId_key"
    ON "UserIntegrationCredential"("userId", "serviceId");
CREATE INDEX "UserIntegrationCredential_serviceId_idx"
    ON "UserIntegrationCredential"("serviceId");

ALTER TABLE "UserIntegrationCredential"
    ADD CONSTRAINT "UserIntegrationCredential_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "UserIntegrationCredential_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "IntegrationService"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- ServiceDispatch: queue + audit log for every push (immediate or delayed)
CREATE TABLE "ServiceDispatch" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "trigger" "IntegrationServiceTrigger" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ServiceDispatchStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "skippedReason" TEXT,
    "requestSnapshot" JSONB,
    "responseSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ServiceDispatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceDispatch_status_scheduledFor_idx"
    ON "ServiceDispatch"("status", "scheduledFor");
CREATE INDEX "ServiceDispatch_serviceId_status_idx"
    ON "ServiceDispatch"("serviceId", "status");
CREATE INDEX "ServiceDispatch_leadId_serviceId_idx"
    ON "ServiceDispatch"("leadId", "serviceId");
CREATE INDEX "ServiceDispatch_leadId_createdAt_idx"
    ON "ServiceDispatch"("leadId", "createdAt");

ALTER TABLE "ServiceDispatch"
    ADD CONSTRAINT "ServiceDispatch_serviceId_fkey"
        FOREIGN KEY ("serviceId") REFERENCES "IntegrationService"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ServiceDispatch_leadId_fkey"
        FOREIGN KEY ("leadId") REFERENCES "Lead"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;

-- Lead.customData for Capture Fields write-back (Phase 3)
ALTER TABLE "Lead" ADD COLUMN "customData" JSONB NOT NULL DEFAULT '{}';

-- Bonzo migration: backfill the existing bonzo service row with templated
-- defaults that reproduce today's per-user webhook behaviour, create its
-- credential field definition, and copy every non-empty UserLeadQuota
-- bonzoWebhookUrl into a UserIntegrationCredential row so the new
-- dispatcher finds the URL via {{user.credentials.bonzoWebhookUrl}}.
DO $$
DECLARE
    bonzo_id TEXT;
BEGIN
    SELECT "id" INTO bonzo_id FROM "IntegrationService" WHERE "slug" = 'bonzo' LIMIT 1;
    IF bonzo_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE "IntegrationService"
    SET
        "method" = 'POST_JSON',
        "statusTrigger" = 'ON_ASSIGN',
        "urlTemplate" = '{{user.credentials.bonzoWebhookUrl}}',
        "bodyTemplate" = '',
        "headersTemplate" = 'User-Agent: FFL-Portal/1.0 (+lead-distribution)',
        "requiresAssignedUser" = true,
        "allowManualSend" = true,
        "description" = COALESCE(
            "description",
            'Forward leads to each assigned LO''s Bonzo account.'
        )
    WHERE "id" = bonzo_id;

    INSERT INTO "IntegrationServiceCredentialField" (
        "id", "serviceId", "key", "label",
        "required", "secret", "placeholder", "helpText", "sortOrder",
        "createdAt", "updatedAt"
    ) VALUES (
        gen_random_uuid()::text, bonzo_id, 'bonzoWebhookUrl', 'Bonzo Webhook URL',
        false, false,
        'https://app.getbonzo.com/webhook/...',
        'Per-user Bonzo inbound webhook URL. Each LO has their own.',
        0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ) ON CONFLICT ("serviceId", "key") DO NOTHING;

    INSERT INTO "UserIntegrationCredential" (
        "id", "userId", "serviceId", "values", "createdAt", "updatedAt"
    )
    SELECT
        gen_random_uuid()::text,
        q."userId",
        bonzo_id,
        jsonb_build_object('bonzoWebhookUrl', q."bonzoWebhookUrl"),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
    FROM "UserLeadQuota" q
    WHERE q."bonzoWebhookUrl" IS NOT NULL
      AND length(trim(q."bonzoWebhookUrl")) > 0
    ON CONFLICT ("userId", "serviceId") DO NOTHING;
END $$;
