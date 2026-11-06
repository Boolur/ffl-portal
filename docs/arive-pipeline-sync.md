# Arive pipeline synchronization baseline

Implemented November 5, 2026. This document describes the inbound baseline requested after the live API acceptance checks. It supersedes the earlier statements that stage/service reconciliation, structured notes, and background polling were unimplemented. Live acceptance results are recorded separately below; automated checks do not establish provider permissions.

## Scope and operation

- Only the existing TESTING TESTER loan 17881588 is eligible. The server verifies its exact portal loan ID, Matt's owner ID, borrower name, Arive number/GUID, and originator email. No loan import or company-wide enrollment is enabled.
- Matt's new-submission pilot remains paused. Its forms, task workflow, document approvals, and stored files are unchanged.
- Admin III can enable, pause, refresh, and acknowledge differences from the existing pipeline Borrower Workspace. Mutations check the current active database account as well as the active session role.
- The worker uses the saved encrypted branch connection and only GET operations: exact-loan search when linking, details, dedicated trackers, paginated notes/replies, and a final details read. No status, key-date, document, credit, webhook, or other Arive write is performed by this worker.
- Vercel checks for due files every minute through `/api/internal/arive/sync`. `CRON_SECRET` authorization and production-environment checks are required. A successful refresh becomes due again five minutes later, giving approximately five-to-six-minute refresh spacing. Empty checks do not call Arive. Failures back off from five to sixty minutes. This is scheduled polling, not a webhook or real-time guarantee.
- The exact-file database state stores enablement, previous source values, provenance, conflicts, issues, retry timing, and a four-minute lease. A paused or superseded worker cannot apply its result. One transaction applies the pipeline, audit, changed package notes, and successful snapshot together. Repeated identical content does not increment the pipeline or document package revision.
- The grid and workspace read current portal data periodically while visible and idle. They do not need to stay open for the scheduled worker to run.

## Field ownership and routing

Arive supplies known stage/status/date values and headed-note fields. Portal assignments, access, processing responsibility, payroll/revenue approvals, projected/final revenue, and first/sixth-payment dates remain portal-owned.

- Actual Arive stage labels appear in the grid and workspace, including intake/qualification stages absent from the legacy portal enum. Underwriting, conditional approval, resubmission, clear-to-close, and docs-out map to the existing portal states. Unknown stages retain routing and show a review issue.
- Suspended moves an active file to Restructures. Funded and documented post-funding stages move it to Fundings; the funded date comes from the actual LOAN_FUNDED milestone. No financial approval is created.
- Known adverse reasons remove an active file by soft archive. Ordinary Arive archival alone requires review. Already inactive files are not silently restored. Funded reversals or adverse action after funding require manager review and preserve Fundings.
- Title, HOI, payoff, appraisal, CD, and rate-lock data map only recognized tracker states. Unknown, duplicated, or unavailable states retain the last confirmed values and show issues. All returned trackers/history remain in the source snapshot and existing tracker view.
- Actual service progress is separate from responsibility. Existing lender and third-party responsibility exceptions suppress only the corresponding reminders, rather than falsifying imported statuses as received/N/A.
- Existing SLA calculations use imported approval, order, appraisal receipt, lock, and expiry dates. Missing/invalid source dates are flagged and do not receive a fabricated current date. Date-only values retain their supplied calendar day in displays.
- A rate-lock request clears only after a confirmed `Locked` tracker with a reliable confirmation date matching or following that request. Same-day date-only confirmation also needs a previously observed unlocked state read after the request. Retained stale data, unknown trackers, or a request created during a read do not establish that proof. The original requester and fulfillment event remain in the audit.

## Structured-note convention

Put a recognized header at the beginning of a line, followed by its value. Header matching ignores case. One note or reply may contain several sections. The latest valid source ordering is updated timestamp, created timestamp, note ID, then section position; its entire section replaces the previous field rather than appending.

```
Pending Items: Updated paystub and insurance binder
Scheduled Signing: 11/18/2026
Payoff Expiry: 2026-11-30
```

These populate Pending Items, Estimated Signing, and Payoff Expiration in the pipeline. Additional recognized headers are `Condition needed:`, `HOI expiration:`, `1004D:`, `Water inspection:`, and `Pest inspection:`; they appear in the workspace's processor updates, with source author/time. No new inspection SLA or task is inferred.

Dates must be real calendar dates in `YYYY-MM-DD` or `MM/DD/YYYY`. Write `Clear` or `None` after a header to deliberately erase its value. Blank, malformed, deleted, or regressed source sections retain the last applied value and raise a review issue. Source text and note/reply identity are retained for provenance; upstream HTML is converted to safe plain text. Importing a note does not notify borrowers or send a note to Arive.

## Conflicts and recovery

For enabled files, a portal attempt to change a confirmed Arive-owned field is rejected with an explicit mismatch warning. The attempted value and retained Arive value are audited; a visible conflict persists across reloads until Admin III acknowledges it. Acknowledgment clears the warning list, not the audit or source value. Unrelated portal edits remain possible, and legacy automatic defaults cannot rewrite imported dates/statuses during those saves.

If Arive changes while it is being read, identity does not match, any required read fails, or the package changes during commit, no partial pipeline update is applied. The last successful data remains visible with the failure time/message. Correct source data in Arive and use Sync now or await the next attempt. Pause stops future imports without reverting already imported values. The existing audit captures changed fields and routing.

## Validation and remaining acceptance

Regression tests exercise the real planner/parser and a transactional database harness: all routes, financial preservation, headed notes/replies/edits/clears, invalid dates, strict identity, incomplete reads, lease fencing, pause races, idempotence, package retention, rate-lock ordering, conflict audits, role checks, cron authentication, and SLA responsibility rules. Funded/adverse/restructure scenarios are fixtures; they are not live financial transitions.

Before broader rollout, confirm provider rate limits and document permissions, agree on restoration after adverse/funded reversal, expand the explicit enrollment policy, and define any additional financial/date ownership. The earlier document classification/list failures are separate from this read-only worker. No document delivery or webhook capability is claimed by this implementation.

Live deployment and acceptance results: pending this rollout's production verification.
