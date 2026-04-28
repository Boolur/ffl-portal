-- Seeds the "Broker Launch Notification" IntegrationService row, which
-- the dispatcher recognizes by method = EMAIL_BROKER_LAUNCH and routes
-- to src/lib/brokerLaunchEmail.ts instead of the HTTP transport.
--
-- Behavior this row encodes:
--   * statusTrigger = ON_ASSIGN      -- fires automatically whenever a
--                                       lead's assignedUserId changes
--   * allowManualSend = true         -- shows up in the admin Push to
--                                       Service modal for batch sends
--   * requiresAssignedUser = true    -- skip leads with no LO
--   * active = true                  -- enabled on deploy
--
-- Non-admins do NOT see this service until explicit rows are added to
-- UserIntegrationServicePermission. `pushLeadsToService` enforces this
-- allow-list for non-admin callers.
--
-- ON CONFLICT on slug keeps this migration idempotent in case it gets
-- re-run or cherry-picked onto a branch where the row already exists.
INSERT INTO "IntegrationService" (
  "id",
  "slug",
  "name",
  "description",
  "type",
  "active",
  "config",
  "kind",
  "statusTrigger",
  "method",
  "urlTemplate",
  "bodyTemplate",
  "headersTemplate",
  "userScope",
  "userIds",
  "campaignScope",
  "campaignIds",
  "excludeSelected",
  "captureFields",
  "requiresBrandNew",
  "requiresNotBrandNew",
  "requiresAssignedUser",
  "requiresOAuth",
  "allowManualSend",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'broker-launch-email',
  'Broker Launch Notification',
  'Sends the legacy Lead Mailbox broker-launch email to the assigned LO. Body is a fixed template (see src/lib/brokerLaunchEmail.ts). Fires automatically on assignment; admins can also batch-send manually from the Leads screen.',
  'email',
  true,
  '{}'::jsonb,
  'CLIENT',
  'ON_ASSIGN',
  'EMAIL_BROKER_LAUNCH',
  '',
  '',
  '',
  'ANY',
  ARRAY[]::text[],
  'ANY',
  ARRAY[]::text[],
  false,
  '[]'::jsonb,
  false,
  false,
  true,
  false,
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("slug") DO NOTHING;
