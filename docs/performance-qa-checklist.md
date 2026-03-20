# Performance QA Checklist

## Role Coverage

- Loan Officer
- Disclosure Specialist
- QC
- VA (generic + specialized)
- JR Processor
- Manager
- Admin

## Core Flows

- Submit new Disclosure request
- Submit new QC request
- Start task
- Complete task
- Send to LO / Send back
- Delete task (manager/admin)

## Validation Points

- Action locks immediately after click (no duplicate click window).
- UI updates optimistically for start/complete/send actions.
- Final state reconciles after refresh.
- No stuck spinner state after successful submission.
- Navigation from Dashboard <-> Tasks remains responsive.

## Notification Checks

- Email sent for new request / routing / completion events.
- No duplicate emails for single action.
- Outbox `failed` count remains flat or recovers on retry.

## Concurrency Checks

- Two users operate on same task:
  - One action succeeds
  - Second user receives clean error/updated state
  - No duplicate completion/routing outcomes.

## Monitoring Snapshot

- Capture p50/p95 action times from perf logs:
  - `action.createSubmissionTask`
  - `action.updateTaskStatus`
  - `action.requestInfoFromLoanOfficer`
- Capture p50/p95 page/query times:
  - `page.tasks.getTasks.total`
  - `page.tasks.render.total`
  - `page.dashboard.render.total`

