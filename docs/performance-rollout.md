# Portal Performance Rollout

This runbook is for progressively enabling performance changes in production with low risk.

## Prerequisites

- Deploy includes:
  - outbox migration and indexes
  - action lock + optimistic updates
  - query slimming updates
- Environment:
  - `NOTIFICATION_DELIVERY_MODE=async`
  - `NOTIFICATION_OUTBOX_SECRET` set
  - `CRON_SECRET` set
  - `PERF_LOG_ENABLED=true`
  - `NEXT_PUBLIC_TASK_OPTIMISTIC_UI=true` (set `false` for emergency rollback of optimistic UI only)

## Production Verification

Before rollout waves, verify critical DB support and queue health:

1. Confirm latest migration is applied in production:
   - `npx prisma migrate status`
2. Confirm task/query indexes exist (Supabase SQL editor):
   - `select indexname from pg_indexes where tablename = 'Task';`
   - `select indexname from pg_indexes where tablename = 'NotificationOutbox';`
3. Confirm queue path is healthy:
   - call `/api/internal/notifications/drain` with `CRON_SECRET`
   - verify the response contains success and drained/retried counts

## Rollout Waves

1. **Wave 0 (internal only, 30-60 min)**
   - Manager/Admin smoke tests.
   - Confirm outbox drain endpoint returns success.
   - Monitor action failures and outbox failed/retry counts.

2. **Wave 1 (power users, ~5%)**
   - Select users across LO, Disclosure, QC.
   - Observe for at least 2 hours.
   - Confirm no duplicate action submissions and no notification drop.

3. **Wave 2 (25-50%)**
   - Expand to VA and JR roles.
   - Continue latency and error monitoring.

4. **Wave 3 (100%)**
   - Full enablement after stability gates pass.

## Health Gates

- Action error rate remains below normal baseline.
- `NotificationOutbox` failed queue does not trend upward.
- p95 navigation and action time improves or remains stable.
- No role-specific regression reports for task completion/routing.

## Rollback Controls

- Set `NOTIFICATION_DELIVERY_MODE=sync` to bypass async queue path.
- If optimistic behavior needs rollback, disable optimistic mode in `TaskList`.
- Re-deploy previous known-good commit if action failures are detected.

