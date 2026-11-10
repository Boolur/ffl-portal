# Arive pipeline synchronization baseline

Implemented November 5, 2026. This document describes the inbound baseline requested after the live API acceptance checks. It supersedes the earlier statements that stage/service reconciliation, structured notes, and background polling were unimplemented. Live acceptance results are recorded separately below; automated checks do not establish provider permissions.

## Scope and operation

- Only the existing TESTING TESTER loan 17881588 is eligible. The server verifies its exact portal loan ID, Matt's owner ID, borrower name, Arive number/GUID, and originator email. No loan import or company-wide enrollment is enabled.
- Matt's new-submission pilot was resumed at his request on November 6, 2026, for his exact active LO account only. This separate submission switch does not expand the background-sync enrollment beyond TESTING TESTER. Existing document approvals and stored files are preserved.
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

### Production acceptance — November 5, 2026 (Pacific time)

- Implementation commit `84b8c73` reached Ready in production at 4:24 PM. The additive migration ran in the normal deployment. TypeScript, targeted ESLint, production build, and 384 regression tests in 25 files passed before publication.
- At 4:25:41 PM, enabling only TESTING TESTER imported Application Intake, the original October 15 stage date, and Title Received. The workspace displayed the original stage age and retained Matt/Martin ownership. The initial stage-date/title discrepancies were visible and acknowledged.
- At 4:27:44 PM, a synthetic Arive note populated Pending Items, Estimated Signing (November 18), and Payoff Expiration (November 30), preserving the calendar dates in Pacific time. Loan-team notifications were unchecked when saving the test note.
- At 4:28:20 PM, a conflicting Pending Items edit in the existing Borrower Workspace was rejected. The attempted text and retained Arive value appeared in the warning, which persisted after closing and reopening the workspace. Acknowledgment then cleared the visible warning.
- Vercel runtime logs show the protected scheduler returning HTTP 200 each minute. A separate unauthenticated production request returned HTTP 401, as required.
- At 4:33:16 PM, the scheduled worker imported a reversible Qualification stage change, Payoff Ordered, a new Pending Items section, and explicit clears of the synthetic signing/payoff dates. The workspace was closed and the portal had been navigated to Overview before the due time. No manual sync was invoked between 4:27:44 PM and this successful background refresh. Reopening the grid/workspace showed the new stage, tracker, note, and blank dates.
- The current branch connection still receives HTTP 403 for document classifications, loan documents, optional private documents, and fees. Details, all 18 trackers, notes, custom fields, existing credit information, and REO reads succeeded. These permissions remain independent of the inbound pipeline baseline.

- At 4:34:43 PM, after checking pause/resume controls, the portal re-imported the restored Application Intake stage (October 15) and Payoff Not Started. Signing/payoff expiry remained blank; Title Received and original assignment ownership remained unchanged. Sync was left enabled only for this exact test file. The explicitly synthetic test notes remain as acceptance history; no test dates remain in the structured fields.
- The existing Documents tab still showed all seven approved active attachments, the imported note history, and the original note's reply after synchronization. All seven files remained Not Sent to Arive; no document-delivery success is implied. The stage-test explanation now states that enabled pipeline sync reflects changes after its next successful refresh.

Funded/adverse/restructure routing, rate-lock fulfillment ordering, invalid-note handling, and concurrent failure cases remain automated-test results rather than live financial transitions. The live stage change was an intake/qualification test, with no notifications sent by Arive's stage dialog. Returning to an earlier Arive stage can remove later milestone dates: only the temporary Qualification milestone was created for this test, and its original October 15 intake date was preserved.

### Tracker responsiveness acceptance — November 10, 2026 (Pacific time)

- Rechecked the authenticated Get Loan Trackers reference. All nine Loan Center trackers in Matt's screenshot are documented: TRID, RATE_LOCK, ITP, APPRAISAL, HOI, TITLE, PAYOFFS, HOA_FEE, and FLOOD_CERTIFICATION. Current status, supplied status date, and status history are readable. The webhook description still does not explicitly cover every readable tracker.
- Live test scope was only TESTING TESTER / 17881588, through Arive Loan Center and the existing BISU Processing Pipeline borrower workspace. Its starting stage was Preapproved (November 6); Title was Received (October 15). These were not changed. Payoffs and Flood Cert both started Not Ordered with no current status date.
- At 11:02:10.679 AM, clicked Payoffs → Ordered. At 11:02:25.344 AM, clicked Flood Cert → Ordered. Arive saved both and displayed November 10 as the status date. These were manual tracker status selections, not service-order buttons, lender registration, or a rate-lock request.
- The already-open BISU tracker panel's automatic refresh timestamp was 11:03:02 AM; both cards displayed Ordered and November 10 when observed at 11:03:31.823 AM. This places the successful read about 52 seconds after the payoff selection and 37 seconds after the flood selection. These are refresh timestamps, not instrumented browser-paint timings.
- The background worker's displayed successful sync time was 11:03:17 AM, about 67 seconds after the payoff selection. The workspace Overview subsequently showed Payoff Ordered. No Sync now, Refresh trackers, or page reload was used to force either transition.
- Restored Payoffs to Not Ordered at 11:04:41.208 AM and Flood Cert at 11:05:04.189 AM. Arive confirmed both original current statuses and blank current dates. Reopening Documents fetched Payoffs already restored; the panel's later automatic 11:06:04 AM read also showed Flood Cert restored, with no current status date. The payoff restoration read should not be described as an uninterrupted panel-poll measurement because the Documents panel had been remounted.
- The next background success was 11:09:17 AM. By 11:09:28.028 AM, the already-open Overview showed Payoff Not started. Restoration therefore took about 4 minutes 36 seconds to synchronize and was confirmed visibly about 4 minutes 47 seconds after the selection. This matches the five-minute due interval plus minute-based scheduler, with separate workspace refresh timing.
- No live loan other than the named test file was edited. No service order, email, borrower message, rate lock, stage change, webhook subscription, or application-code deployment was initiated. Current statuses/dates were restored; normal audit history of the test was not erased. Historical milestone-date restoration was not independently established.
- Browser screenshot capture failed twice with a Page.captureScreenshot timeout. Evidence for this run is the live page's rendered values and refresh timestamps, not a saved screenshot. The main-pipeline test covered Payoffs; Flood Cert was verified in the detailed tracker display, which has no dedicated main-grid mapping. Other tracker transitions were not exercised in this run.

### Borrower workspace refresh — November 10, 2026

- Replaced the pipeline borrower's eight top-level tabs with Loan & Property, Borrower Info, Financial Info, and Loan Center. Loan Center opens on Services & milestones, with separate Notes, Documents, and Activity sections.
- Added featured Title, HOI, Appraisal, and Payoffs source-status cards. Missing/ambiguous Arive statuses are not inferred from retained portal values. Unstarted states are red, progress blue, receipt green, and waived/not-needed states neutral.
- Kept existing edit permissions, draft preservation, conflict restoration, loan ownership, task/document authorization, and pilot enrollment. Compact synchronization controls remain visible across tabs.
- Added searchable, newest-first imported Arive note/reply history with author and timestamps. The latest structured-header values are explicitly separate from history; historical versions of edited notes and deleted source notes are not available from the imported history.
- The verified existing loan-details read now captures a strict allowlist of application terms, financial figures, housing expenses, applicant residence, and employment. Projection stays restricted to the existing exact test-file pilot and scoped borrower action. No additional API calls or credentials are needed. No full 1003/PDF, SSN, birth date, account number, raw income object, asset/liability schedules, or underwriting declarations are exposed.
- The application snapshot is refreshed by Sync now and the existing background worker. A new successful sync is necessary after deployment before the application panels have data.
- Returning Appraisal to NOT_ORDERED clears only a verified prior Arive-derived requirement inference, preserving independent portal requirements and source-supplied history dates.
- Successful sync timestamps refresh mounted notes/documents/tracker panels. Skipped/failed sync responses no longer claim a successful refresh.

### Live demo acceptance — November 10, 2026

- Production commit 30b360a deployed successfully. TESTING TESTER 17881588 alone was used for live changes; no real service orders, stage/funding changes, or financial approvals were initiated.
- Saved Title Received (existing October 15 source date), HOI Ordered (November 10), Appraisal Waived (November 10), and Payoffs Ordered (November 10) in Arive. Email/SMS and loan-team notifications were disabled where Arive prompted before saving.
- Added a clearly marked synthetic note containing all eight supported headers. At 12:33 PM Pacific, the actual workspace Sync now completed and the mounted notes panel changed from 3 notes/1 reply to 4 notes/1 reply, newest first, without reopening or waiting for its former one-minute poll. Completion and refreshed history were observed within approximately 13 seconds.
- Verified all eight current structured values, Scheduled Signing 11/18/2026 and Payoff Expiry 11/30/2026 in Key dates, and all four source-status cards. Financial values matched Arive: $400,000 loan, 7.125% note rate, 50% LTV, 6.49% DTI, $3,244.87 housing total, plus employer record. Seven approved submission files remained accessible.
- All Arive trackers resolved the authorized document package and loaded 18 current tracker entries. Subsequent Sync refreshed that mounted panel too.
- Appraisal's actual final API label was confirmed as COMPLETE, not only RECEIVED. Added that exact appraisal-only alias for requirement/receipt-date mapping and green card styling, with no widening to other unknown statuses.
- Added documented property address/type/occupancy/value to the same allowlisted application snapshot. Unsupported year-built/acquisition/vesting remain portal fields.
- Final live restoration is recorded after verification of the follow-up deployment.
