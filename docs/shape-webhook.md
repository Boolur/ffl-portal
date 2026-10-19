# Shape inbound webhook

Endpoint after deployment: `POST https://bisuportal.com/api/webhooks/shape`

Required headers:

- `Content-Type: application/json`
- `X-Webhook-Secret: <shared inbound secret>`

Configure a random server-only `SHAPE_WEBHOOK_SECRET` of at least 32 characters in production. This is a separate credential from the outbound Shape API key. Share it with Shape through an approved secure channel, never in the URL. Confirm Shape supports this header; adapt authentication if their supported delivery method differs.

The receiver accepts JSON objects and arrays up to 1 MiB. It preserves the complete parsed JSON in `WebhookInboxEvent` with source `shape`, receipt time, and status `PENDING`. It retains only allowlisted request metadata and never stores the authentication header. Admins can inspect the payload in Lead Distribution's webhook inbox. Pending records are retained until explicitly deleted; do not use the inbox's bulk clear on Shape records needed for future mapping.

HTTP 202 means durable capture succeeded, not that a disposition was updated. Response: `{"accepted":true,"inboxEventId":"<receipt-id>","processing":"awaiting_mapping"}`. Storage failures or missing server configuration return 503; Shape should retry with backoff. Invalid credentials return 401, malformed JSON 400, unsupported content type 415, oversized bodies 413. No browser session is required.

Every delivery is stored, including duplicates. No lead is created, modified, reassigned, or forwarded. No Arive request, campaign, or outbound Shape request is triggered. Existing generic lead-ingestion replay does not process Shape records. Stored receipts are available for a later dedicated mapping/processing implementation.

Ask Shape to include the original portal ID (`mktentryid`, supplied when creating the lead), Shape record ID, exact status/disposition, assigned officer, event type, unique event ID, and event occurrence timestamp. These are requested fields, not assumptions enforced by the current receiver. Ask for a real sanitized sample and their retry/signature/header capabilities.

Before enabling actions, implement and test portal-ID/Shape-ID matching, disposition mapping, duplicate-event protection, out-of-order update protection, loop prevention, and explicit routing rules. Preserve receipts separately from downstream processing outcomes so failed actions can be retried without losing incoming data.
