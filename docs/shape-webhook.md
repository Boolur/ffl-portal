# Shape inbound webhook

Endpoint after deployment: `POST https://bisuportal.com/api/webhooks/shape`

Required headers:

- `Content-Type: application/json`
- `X-Webhook-Secret: <shared inbound secret>`

Configure a random server-only `SHAPE_WEBHOOK_SECRET` of at least 32 characters in production. This is a separate credential from the outbound Shape API key. Share it with Shape through an approved secure channel, never in the URL. Confirm Shape supports this header; adapt authentication if their supported delivery method differs.

The receiver accepts JSON objects and arrays up to 1 MiB. It preserves the complete parsed JSON in `WebhookInboxEvent` with source `shape`, receipt time, and status `PENDING`. It retains only allowlisted request metadata and never stores the authentication header. Admins can inspect the payload in Lead Distribution's webhook inbox. Pending records are retained until explicitly deleted; do not use the inbox's bulk clear on Shape records needed for future mapping.

HTTP 202 means durable capture succeeded, not that a disposition was updated. Response: `{"accepted":true,"inboxEventId":"<receipt-id>","processing":"awaiting_mapping"}`. Storage failures or missing server configuration return 503; Shape should retry with backoff. Invalid credentials return 401, malformed JSON 400, unsupported content type 415, oversized bodies 413. No browser session is required.

Repeat deliveries overwrite the stored Shape inbox payload for the same original portal ID (`lead_id`, `original_id`, or `mktentryid`) or `shape_lead_id`. The complete latest accepted payload replaces the previous body, including changed statuses and removed fields. The receipt ID stays stable and receipt time is refreshed. Existing duplicate inbox rows are consolidated on the next delivery. A transaction-scoped database lock prevents simultaneous deliveries from creating duplicates. Conflicting portal IDs are rejected rather than merged. Records without a usable ID are stored separately; email and phone are never used as identity keys. Arrays are handled per item in one transaction and return `inboxEventIds`.

No portal lead is created, modified, reassigned, or forwarded. No Arive request, campaign, or outbound Shape request is triggered. Existing generic lead-ingestion replay does not process Shape records. The inbox is now a latest-payload store, not a history of every delivery. With no sender timestamp or revision, latest accepted delivery wins, even if it is a delayed older event.

Ask Shape to include the original portal ID (`mktentryid`, supplied when creating the lead), Shape record ID, exact status/disposition, assigned officer, event type, unique event ID, and event occurrence timestamp. These are requested fields, not assumptions enforced by the current receiver. Ask for a real sanitized sample and their retry/signature/header capabilities.

Before enabling actions, implement and test portal-lead lookup, disposition mapping, out-of-order update protection, loop prevention, and explicit routing rules. Preserve captured data separately from downstream processing outcomes so failed actions can be retried without losing incoming data.
