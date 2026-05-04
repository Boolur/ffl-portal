-- The portal already has a first-class per-user Bonzo forwarder that runs
-- when a lead is assigned. Keeping the Bonzo IntegrationService on ON_ASSIGN
-- creates a second POST to the same LO webhook for every lead. Leave the
-- service available for manual Push to Service, but remove the auto trigger.
UPDATE "IntegrationService"
   SET "statusTrigger" = 'MANUAL',
       "updatedAt" = NOW()
 WHERE ("slug" = 'bonzo' OR "type" = 'bonzo')
   AND "statusTrigger" <> 'MANUAL';
