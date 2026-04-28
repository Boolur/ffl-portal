-- Trim the Broker Launch Notification service's description down to a
-- single line so it renders on one row inside the Push to Service modal
-- card -- matching the Bonzo card's layout. The old description leaked
-- implementation details (source-file path, trigger plumbing) that
-- admins don't need to see in the picker.
UPDATE "IntegrationService"
   SET "description" = 'Sends the legacy Lead Mailbox broker-launch email to the assigned LO.',
       "updatedAt"   = NOW()
 WHERE "slug" = 'broker-launch-email';
