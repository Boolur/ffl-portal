# Employee onboarding

## What ships in the first release

- Restricted `ONBOARDING` portal accounts
- New-hire personal information and secure document upload
- Management checklist based on the BISU onboarding CSV
- Assigned owners, due dates, review/change requests, approval, and audit history
- Atomic promotion from `ONBOARDING` to the approved portal role(s)
- Queued email, in-app updates, and daily overdue reminders
- Provider-neutral signature tracking with a manual fallback

DOB, address, compensation, document paths, and form values are excluded from the
general user directory and audit event details. The onboarding storage bucket must
remain private.

## Deployment

1. Create a private Supabase bucket named `onboarding-documents`.
2. Configure `SUPABASE_STORAGE_BUCKET_ONBOARDING_DOCUMENTS`,
   `SUPABASE_SERVICE_ROLE_KEY`, Graph sender credentials, `CRON_SECRET`, and
   `NOTIFICATION_OUTBOX_SECRET`.
3. Deploy the Prisma migration. It adds enum values before creating the onboarding
   tables and does not backfill existing users.
4. Run `npx ts-node --compiler-options "{\"module\":\"CommonJS\"}" src/scripts/seedOnboardingTemplate.ts`
   once, or allow the first onboarding case to create the idempotent v1 template.
5. Set `NEXT_PUBLIC_ONBOARDING_ENABLED=false` for the initial deploy. Verify an
   Admin III account, then set it to `true` and redeploy.
6. Create one internal test case and exercise invite acceptance, profile submission,
   document access, changes requested, checklist completion, approval, and promotion.

## Access model

- Admin I–III: onboarding access follows existing user-management tier rules.
- Manager: only cases owned by the manager or containing an item assigned to them.
- Onboarding user: only their own candidate-facing fields and documents marked
  `NEW_HIRE` or `BOTH`.
- Final approval, cancellation, destination-role edits, and promotion require an admin.

Every server action re-reads the current user roles from the database so a stale JWT
cannot grant management access. Promotion updates `User.role`, `User.roles`, and the
case status in one database transaction. The promoted user should sign out and back in
to refresh their portal immediately.

## Notifications and reminders

Onboarding emails use the existing `NotificationOutbox` with the `ONBOARDING` event
type and are drained by the existing notification cron. The daily
`/api/internal/onboarding/reminders` cron queues one reminder per overdue item per day.
Both internal endpoints require configured secrets.

## E-sign configuration

`ESIGN_PROVIDER=manual` keeps the built-in upload and status-tracking workflow. A
remote adapter can be enabled by configuring:

- `ESIGN_PROVIDER=http`
- `ESIGN_API_BASE_URL`
- `ESIGN_API_TOKEN`
- `ESIGN_WEBHOOK_SECRET`

The webhook endpoint requires an HMAC SHA-256 signature in `x-esign-signature`.
Provider events are idempotent by envelope ID and update only the mapped onboarding
document. Signed artifacts should be copied into the private onboarding bucket by the
provider adapter.

## Rollback

Turn off `NEXT_PUBLIC_ONBOARDING_ENABLED` first. Existing ordinary users and invites
do not depend on onboarding tables. Do not remove the PostgreSQL enum values during an
emergency rollback; leave the additive migration in place and revert application code.
