# Pilot and Arive infrastructure

Backend milestone, November 12, 2026. Based on accepted production `94814d4`.
This change leaves the redesign checkout, layouts, navigation, themes, document
cards and delivery behavior untouched. It supplies interfaces for later integration.

## Disabled deployment

All four deployment gates default off, and absent database controls are off:

- `PILOT_VIEW_ENABLED`: allows eligible users to persist the Pilot preference.
- `PILOT_PRACTICE_ENABLED`: also required for practice actions and documents.
- `ARIVE_SHARED_TRANSPORT_ENABLED`: routes every Arive session through shared
  request controls. When on, a missing/paused runtime fails closed.
- `ARIVE_ROLLOUT_ENABLED`: permits generalized collection, still requiring
  collection/enrollment/application controls and an authorized request budget.

Matt's existing submission pilot and TESTING TESTER sync remain unchanged until
explicit cutover. Adding schema does not enroll files or call Arive. Appearance,
practice work and canonical synchronization are three independent concerns.
No client mode flag selects a production versus practice mutation.

### Pilot button follow-up (initial switch release)

The top bar now includes a Pilot on/off switch for server-authorized Admin I/II/III
accounts and Matt. The initial switch release enabled only `PILOT_VIEW_ENABLED`;
practice and generalized collection remained off then. The preference persists
without refreshing the page or discarding open work. The current screens still
use live records; enabling the preference does not create practice copies or
activate synchronization. The facelift and explicit practice/live entries follow
in the design milestone. Other open tabs pick up the saved preference on reload.

## Server contracts

Practice actions return `{success:true,data}` or `{success:false,error}`. Other
actions return `{success:true,...fields}` or `{success:false,error}`. Refetch after
mutations; practice mutations require optimistic versions. Actions recheck current
database account, active role and record access, rather than trusting cached UI.

### Preferences

`src/app/actions/pilotPreferenceActions.ts` exposes `getPilotPreferences()` and
`setPilotViewEnabled(enabled)`. Eligibility is the exact Matt account or a current
Admin I/II/III account. Eligibility does not grant a role or new loan visibility.
Disabling appearance makes effective mode Standard, retaining preference/progress.

### Practice tasks and documents

`src/app/actions/practiceTaskActions.ts`:

- `listPracticeTasks()` lists current user's authorized copies.
- `createPracticeTask({sourceTaskId?,sourceLoanId?,title?,draft?})` copies one
  authorized source, or creates a synthetic practice submission. Captured source
  IDs, timestamps/version and safe form context are immutable afterward.
- `getPracticeTask(id)` returns snapshot, separate editable draft, checklist,
  files, conversations and internal simulated notifications.
- `savePracticeSubmission({id,version,persona:'LO',draft})` changes allowlisted
  practice form fields in DRAFT/CHANGES only.
- `changePracticeTask({id,version,persona,action,...})` supports SUBMIT, START,
  REVIEW, REQUEST_DOCUMENT, ADD_DOCUMENT, WAIVER, CLEAR_WAIVER, RETURN, APPROVE,
  REJECT, NOTE and RETIRE_FILE. Use the exported `PracticeCommand` input type.

Workflow: DRAFT -> REVIEW -> STARTED -> APPROVED/REJECTED. Corrections move STARTED
-> CHANGES -> REVIEW and require Start again. JR decisions require STARTED.
Categories support multiple files, N/A explanations and additional-document labels.
LO/JR personas simulate practice only; they never alter real roles or permissions.

Separate PilotPracticeTask, Package, File, Event and Notification tables are used.
Practice actions do not call live task actions, payroll, staff notifications, Arive
writes or original-attachment mutations. Every operation and delivery rechecks
source access. Source deletion/revocation blocks sensitive access without erasing
practice progress. Later UI must call existing live actions from an explicit live
entry; it must not pass practice IDs to production Task handlers.

`src/app/actions/practiceDocumentActions.ts` supplies upload preparation/finalization
and `preparePracticeDocumentDownload` / `validatePracticeDocumentDownload` using
the existing flat ZIP manifest protocol and revision/selection validation.

- New uploads use `pilot-practice/{owner}/{task}/{uuid}.{ext}` in a private bucket.
  Optional `SUPABASE_STORAGE_BUCKET_PRACTICE_ATTACHMENTS` selects a separate private
  bucket; otherwise the existing private attachment bucket uses a distinct prefix.
- Metadata verification supports current and older storage formats and enforces
  ownership, size, PDF/JPEG/PNG type, private bucket and aggregate limits.
- Original attachments are read-only references with original authorization.
- GET `/api/pilot/practice/{taskId}/files/{fileId}` previews; `?download=1` downloads;
  `?prepare=1` returns safe metadata without a public storage URL.
- Expired sessions return JSON 403, never a login page disguised as a PDF.
  ZIPs are flat; revalidate selection before assembly. Retiring a file does not
  delete an original attachment or storage object. Cleanup is a separate operation.

### Integration controls

`src/app/actions/ariveRolloutActions.ts` requires a fresh active Admin III role:

- `getAriveRolloutStatus({cursor?})`: paged enrollments, controls and safe metrics.
- `inspectAriveAccessibleLoanCount()`: one shared-budget, count-only search using
  the saved connection (`limit=1`, no filter), at most once per five minutes. Returns
  provider count, row count and time only; it does not log or expose the sample
  borrower's data. API visibility is distinct from portal enrollment and matching.
- `inspectAriveLoanCoverage()`: optional visibility inspection, at most ten pages
  of 100 records and 90 seconds with a 25-second reserve, once per five minutes.
  Reports completion/partial reasons, originator aggregates, and numeric overlaps
  with eligible portal loans. No provider borrower payload or GUID is returned or
  audited. A numeric overlap never authorizes enrollment: Verify file still runs
  the independent identity, originator, eligibility, practice and cohort checks.
- `configureAriveRollout({collectionEnabled,applicationEnabled,enrollmentEnabled,
  cohortLimit?})`: independent controls and atomic generation fencing. Cohort
  limit is 10, 50 or null for the remainder; default 10.
- `configureAriveRolloutRequestAllowance({providerRequestLimit,
  providerWindowSeconds,enabled})`: provider-confirmed allowance only. Effective
  ceiling is floor(80%); no guessed allowance is supplied.
- `configureAriveRolloutOperatorBudget({requestsPerMinute,enabled})`: separately
  authorizes a BISU ceiling of 10–600 requests per minute, recording the fresh
  Admin III actor and timestamp. This is not an Arive-confirmed quota. The exact
  cap applies without the provider allowance's 80% multiplier.
- `enrollAriveRolloutFiles()`: bounded existing-file scan.
- `verifyAndEnrollExistingAriveLoan({pipelineId})`: explicit older-funding path,
  requiring the same identity verification, quota and cohort controls.
- `queueAriveRolloutRefresh({pipelineId})`: deduplicated refresh queue; no direct
  fetch or bypass of shared budget/leases.
- `queueAriveRolloutCohortRefresh()`: Admin III can queue the already-enabled,
  verified generalized cohort for another scheduled read. It neither enrolls nor
  enables files, retains pending timestamps and retry delays, and makes no provider
  calls itself. Use this for repeat-cycle checks, including hourly Funding files.
- `setAriveRolloutLoanEnabled({pipelineId,enabled})`: per-loan exception/pause.
  Automatic enrollment does not silently re-enable an operator-paused file.
- `getAriveRolloutReview({pipelineId})`: saved safe collection/proposed-change view.
- `registerPracticeAriveLoan({ariveLoanId,label,ariveGuid?})`: register an already
  created synthetic file. Registry entries stay excluded even when disabled.
- `transferLegacyAriveRolloutFile({pipelineId})`: explicit atomic worker handoff;
  does not claim to retire the old submission interface.

`getProcessingAriveSnapshot(id)` in `processingPipelineActions.ts` reads authorized
saved application, structured values/provenance/conflicts and full plain-text
notes/replies newest first. It makes no API call. Grid/detail reads understand
applied verified generalized states. `getProcessingPipeline` supports
`filters.ariveStages` and `sortBy:'ariveStage'` alongside existing portal enums.
`getProcessingAriveStageCounts({sheet,filters?,viewScope?})` provides documented
options and scoped counts using the same predicates as the row manifest.

## Identity, authority and routing

Candidates are existing active Pipeline/Restructures loans and Fundings from the
last 90 days. Missing funding eligibility dates create exceptions. Older Fundings
are explicitly refreshable. No bulk loan import is implemented.

Numeric loan number, permanent GUID, saved branch connection and mapped originator
email must agree; borrower identity is also checked exactly. Ambiguous/incomplete
matches are quarantined. Correct source identity then reverify; no force-match
bypass is provided. Automatic enrollment never takes legacy-owned records.

Collection-only saves a proposed-change snapshot without changing canonical
fields, tasks, approvals, notes or normal edit ownership. Application updates real
enrolled loans for both Standard and Pilot users:

- Funded/Broker Check Received/Commission Paid route to Fundings; Suspended to
  Restructures. Confirmed adverse action soft-archives active nonfunded records.
- Reactivation requires confirmed active status and exact prior sync ownership,
  generation, route and pipeline version. Subsequent manual changes cancel automatic
  restoration. Unknown/unresolved indicators retain routing and create issues.
- Ever-funded protection persists independently of provider milestone history.
  Reversals/adverse after funding require manager review. Existing funded records,
  approved/paid payroll and imported funding history protect financial routing.
- Actual LOAN_FUNDED date drives funding. Each missing First/Sixth Payment date
  uses existing BISU calculations. Populated dates remain, with disagreement flags.
  Sixth Payment preserves `addMonthsClamped(fundedAt,6)`.
- Service mappings, responsibility exceptions, SLA dates, reliable rate-lock
  confirmation and Arive-wins conflict warnings remain. Assignments, responsibility,
  financial approvals and payroll remain portal-owned. No new outbound loan or
  document API operations are introduced.

Eight note headers are retained: `Pending Items:`, `Scheduled Signing:`,
`Payoff Expiry:`, `Condition needed:`, `HOI expiration:`, `1004D:`,
`Water inspection:`, `Pest inspection:`. Matching ignores case, requires a line
boundary, and accepts multiple sections/replies. See `arive-pipeline-sync.md` for
date formats, explicit clearing, source removal and provenance behavior.

## Queue and API capacity

Minute cron `/api/internal/arive/sync` runs owners separately; minute cron
`/api/internal/arive/sync/enroll` handles up to 100 enrollment candidates and stops
when the current cohort fills, preserving its cursor. Both require CRON_SECRET and
production environment. Disabled rollout performs no new collection/enrollment.

Persistent oldest-due queue, two-file waves, globally enforced request concurrency
of two, bounded worker time, per-file leases and global generation fences protect
overlapping workers and pauses. One minute active / hourly recent-funding or
sync-archived are targets, not guarantees: quota, latency, note pagination and cohort
size govern actual freshness. The minute interval is a due target, not a maximum
end-to-end delay. Manual refreshes persist a deduplicated request and attempt the
same shared worker immediately; busy/cooldown responses remain queued. Scheduled
work prioritizes the oldest manual request, then never-read/oldest-due files. Failed
reads retain a five-minute exponential base rather than adopting the faster success
interval. Each worker remains deadline-bound with at most 500 attempts and two-file
waves; the transport enforces global HTTP concurrency of two across all instances.

Authentication, pagination, panels and retries share a rolling request budget.
Encrypted tokens are reused with expiry margin, refresh leases and credential
fingerprint invalidation. GET authentication can refresh/retry once. Provider
cooldowns and retry backoff retain the last complete successful applied snapshot.
Operator-authorized budgets preserve existing usage and cooldowns when changed.
An Arive 429 halves the operator ceiling, with a floor of 10, once per cooldown
episode; increases require another explicit operator configuration. A busy request
slot may wait up to five seconds before dispatch, always rechecking the shared
budget and global concurrency. This never retries an already-sent request.

For a new API key: pause generalized collection, disable shared deployment gate,
test/save through protected existing setup, confirm that key's quota or explicitly
authorize its operator budget, then re-enable
shared transport and collection. Same-key secret/client rotation invalidates tokens
without resetting usage. Never log credentials or paste them into chat.

## Release and acceptance procedure

1. Run tests, type checks, lint and `npm run build`. **Build only compiles.**
   `npm run db:deploy` is separate. Hosted `release:vercel` explicitly migrates only
   when VERCEL=1 and VERCEL_ENV=production, then compiles. Previews never migrate.
2. Deploy additive `20261112190000_pilot_rollout_infrastructure` with all four new
   flags unset/false. Existing sync rows default LEGACY, new controls default off.
3. Verify production release and existing tasks/sync/downloads. Keep the broader
   cohort disabled during this infrastructure milestone.
4. Later, re-read the latest accepted redesign and integrate these interfaces into
   current production components. Retain four borrower tabs, drafts, identity-scoped
   caches, scroll restoration, themes and document-delivery behavior.
5. Capture Standard performance before collection. Add the Pilot switch, context
   labels, practice-copy entry and explicit live-work action. Test accessibility,
   responsive layouts and both themes. Retire new legacy Matt submission creation
   only after replacement acceptance; grandfather existing package access/completion.
6. Create three clearly synthetic Arive files without invitations/messages/credit/
   services; register their IDs before enrollment. Test practice workflow and real
   reads. Read acceptance does not establish document-upload permission.
7. Save a confirmed provider quota or an explicitly authorized operator cap before
   enabling the shared transport gate; enable collection with application
   false and cohort limit 10. Review matches, exceptions and proposed differences.
8. Transfer TESTING TESTER with the worker-handoff action. Its transaction increments
   workerGeneration, changes one owner and clears the prior lease. In-flight legacy
   reads cannot commit; tasks/packages/history remain. Coordinate submission-creation
   retirement in the later UI milestone, not by changing this worker alone.
9. Enable application for verified 10, then 50, then remainder. Require two successful
   cycles, matching/freshness checks and acceptable Standard performance at each step.
10. Pause collection/application/enrollment to fence in-flight results. Pause never
    reverses completed changes. Appearance-off affects appearance only. Prior app
    code can be restored while leaving additive schema/history intact.

## Verification boundaries

Offline PostgreSQL migration verification passed with PGlite: existing enabled
legacy records preserved; new controls off; schema exactly matches Prisma;
practice writes/cascades do not mutate canonical records; source deletion does not
erase practice records. Reproduce with `src/scripts/verifyPilotSchema.mjs --runtime`
pointing to a separately installed PGlite package; it uses no production connection.

Backend tests cover practice isolation/access, source/file revocation, metadata,
ZIP validation, routing/restoration, funding protection, notes/conflicts, shared
quota/token behavior, throttling/partial reads, overlapping workers and pause races.
Live design acceptance, synthetic Arive file creation, provider capacity confirmation
and broader activation remain the next milestone. A disabled infrastructure release
is not evidence those later live checks have passed.

## Operator controls and application detail coverage

Admin III → Arive Integration exposes the saved rollout status, matching inventory,
known test-file registry, controls, and collected-difference review. These reads make
no provider calls. `inspectAriveReportedAllowance` makes one known TESTING TESTER GET
(plus authentication when needed), no more than once per minute across operators.
It reads only documented `X-RateLimit-Limit`/`X-RateLimit-Remaining` headers. A missing
or malformed limit is not confirmation and never enables collection. Run this probe
and save a confirmed allowance or explicitly authorized operator cap **before** enabling the shared deployment gate;
the shared transport deliberately fails closed without its saved budget.

`measureAriveTestReadTiming` is a preactivation diagnostic for the known synthetic
file: at most 12 sequential GETs, a 90-second sampling deadline, one run per ten
minutes across operators, and no retries after an error. It is unavailable once
shared transport is active, so its 12-request bound cannot be expanded by shared
token-refresh retries. Timings and a two-request-concurrency sweep estimate are
saved without response bodies. These measure latency only; they do not confirm
quota, enable enrollment, or establish sustained capacity.

The borrower workspace uses saved, authorized snapshots and loan-scoped notes for
generalized loans. Opening tabs adds no Arive requests. Paused, previously applied
snapshots remain visible with resume controls; pausing an individual enrollment
releases edit ownership without deleting its saved data.

The v1 allowlist includes documented borrower contacts, residence, loan terms,
property, employer income summaries, costs, lender/product and rate-lock details.
It now includes employer phone/classification, interest-only/ARM terms and additional
documented contacts/loan/property fields. Missing older snapshot fields normalize
to null. It is not a complete 1003 export: itemized assets/liabilities, declarations,
opaque borrowerIncome and the separate REO endpoint are not inferred or collected.
No SSNs, raw provider bodies, or new outbound loan/document operations are introduced.

## Production verification — November 12, 2026

- Release `038adeb` deployed successfully. Admin III controls loaded with collection,
  application, shared transport and generalized rollout still off; Pilot appearance
  remained on for the signed-in eligible account.
- The bounded provider-limit probe authenticated and read TESTING TESTER successfully,
  but no usable documented request-limit header was returned. No provider allowance
  was saved or invented, and no broad polling was activated.
- Database inventory at the check contained 308 Pipeline, 101 Restructures and 390
  eligible-or-undated Funding records. Enrollment must still verify identities;
  these counts are candidates, not confirmed Arive matches.
- Known test-file registry contained TESTING TESTER, Arive loan 17881588, under the
  legacy collector. No other registered practice files were present.
- In its live processing workspace, Borrower Info showed Arive contacts/residence;
  Financial Info showed housing expenses, qualification figures, financing and the
  employer phone/classification. Its successful background sync was visible at
  4:04:18 p.m. Pacific. This validates the existing synthetic file, not broad cohorts.
- Release `50d6064` deployed successfully. At 4:10:34 p.m. Pacific the bounded
  production sample completed all 12 GETs / three cycles on TESTING TESTER without
  an error: median 96.5 ms, sample p95 138 ms. The measured API-only estimate was
  72 seconds for 409 active Pipeline/Restructures files at global concurrency two.
  Authentication, database work, notes pagination, cron phase and quota waits add
  time; this is an extrapolation from one synthetic file, not a sustained load test.
  The sample did not establish an approved request allowance, enroll real loans,
  or enable any generalized rollout controls.

## Operator-authorized activation preparation — November 12, 2026

The owner explicitly authorized broad activation without waiting for a provider
quota. The new operator budget records that decision separately from provider
confirmation. Planned live ramp: 120 requests/minute for 10 verified files, then
300 for 50, then up to 600 for the remaining verified cohort after healthy cycles.
Global concurrency stays at two. These are self-imposed caps, not measured Arive
capacity; automatic throttling can reduce them.

Predeployment verification: 1,524 tests passed; one live-storage test skipped because
its credentials were absent. Type checks, focused lint, and offline schema checks
passed. The migration preserves existing provider settings and legacy integration;
operator fields remain unauthorized by default. Missing Arive funding history now
retains an existing funded date and raises a review issue. Actual cohort activation
and freshness results must be recorded after production checks, not inferred from
these local tests.

## Production rollout observations — November 12, 2026

The shared transport and generalized rollout deployment gates are now enabled:
`ARIVE_SHARED_TRANSPORT_ENABLED=true` and `ARIVE_ROLLOUT_ENABLED=true`. The saved
request budget is an operator-authorized cap of **120 requests per minute**, with
global concurrency two. It is not a provider-confirmed allowance. The planned
300/600-request ramp has not been established by these observations.

Release `926c613` includes the bounded visibility inspection and the earlier cohort
refresh, count-only coverage and enrollment-diagnostic controls. Release verification
passed 1,585 tests with one live-storage test skipped; type checks, focused lint,
production compilation and all six offline schema checks also passed. This verifies
the code and migration boundaries, not full-pipeline API access or freshness.

Follow-up commit `4a1f88c` was pushed to main to reduce transport lock contention:
completing a request releases its own reservation without the global admission
lock, and display-only metrics no longer take that lock. Request admission still
enforces the shared budget and concurrency under the global lock. Verification
passed **1,587 tests with one skipped**, including **151 focused tests**, plus lint,
type checks and `npx next build`. The `npm run build` Prisma-generation step hit an
existing Windows DLL file lock held by Node; direct production compilation passed
using the already generated client. The schema was unchanged and no local migration
was run for this follow-up.

Release `4a1f88c` subsequently reached Ready. The larger cohort exposed a separate
scheduling issue: a worker could begin another wave with only 30 seconds left,
then encounter the per-request 25-second reserve and incorrectly start a five-minute
failure backoff. Follow-up `1f7ae3c` was pushed to main and subsequently reached
[Ready on Vercel](https://vercel.com/matt-mahjoubs-projects/ffl-portal/JCGrkPtmSaSUexKiykX4GPioYDJD).
It requires 75 seconds of remaining time both before and after the due
query, and treats an exhausted invocation deadline as a 60-second scheduling deferral.
It preserves complete snapshots, queued manual requests and previous failure/error
history, releasing only its own fenced lease. Actual API failures and the individual
loan's 150-second read budget retain their existing backoff behavior. Verification
passed **1,594 tests with one skipped**, including **70 worker tests**, plus lint,
full type checks and production compilation. Production repeat-cycle acceptance
after this deployment is recorded below.

### Saved connection visibility

- The complete bounded inspection read **564 of 564** API-visible loans with a
  consistent reported count. These are all loans visible to this connection, not
  just the active BISU pipeline or the enrolled cohort.
- BISU contained **799 eligible candidate records**: 409 active Pipeline/Restructures
  records and 390 recent-or-undated Funding records. Missing funding dates still
  require review before enrollment.
- **45 existing eligible BISU records** had numeric loan numbers in the complete
  API listing; **754** did not appear. Numeric overlap does not establish a valid
  identity, originator mapping, enrollment or permission to apply changes. Each
  candidate still goes through the existing independent verification action.
  The overlaps comprise **11 Pipeline, 16 Restructures and 18 Fundings** records,
  including TESTING TESTER.
- Originator aggregates were **313 loans under Matt Mahjoub, 207 under Mo Daneshfar,
  and 44 loans under other originators**. The saved API connection is therefore not
  limited to Matt's loans.
- Ten initial non-Matt candidates returned no exact-search result. A separate
  check of Jarrid, Arive loan **17981070**, also returned zero API results even
  though the Arive UI displayed the loan under Mo Daneshfar. This establishes a
  visibility difference between the current API connection and that UI session;
  it does not by itself identify Arive's filtering or permission rule.

The inspection did not enroll, enable or modify any loan. Originator counts are
aggregated; borrower names in the overlap list come from existing authorized BISU
records, not from the provider response. Audit records contain summary counts only.

### Observed update timing and accepted verified cohort

For the active Maritza file, successful background timestamps advanced from
**4:46:35 p.m. to 4:48:30 p.m. to 4:50:32 p.m. Pacific**: approximately two minutes
between observed updates, despite the 60-second due target. These measurements
must not be presented as instant synchronization or a guaranteed one-minute delay.

After opening a fresh portal page, manual Sync reported a queued request and the
successful timestamp subsequently advanced to **4:55:30 p.m. Pacific**. Manual
requests continue through the same leases and shared budget. Older tabs already
open across deployment needed a fresh load to use the updated controls.

The first verified cohort passed two complete application cycles. At **5:00:33 p.m.
Pacific**, the status showed **10 of 10 applied**, with 5:00:33 as the latest
successful update. A later check still showed **10 of 10 applied**, with the oldest
successful update at **5:00:51** and the latest at **5:02:34**. Every cohort member's
second successful timestamp was therefore later than the first cohort's completion
timestamp. Unchanged successful checks count toward this evidence; change-audit
counts alone do not establish cycle completion.

After that acceptance, the cohort limit was raised to **50**, while the operator
cap remained **120 requests per minute**. No Arive 429 had been observed at that
point. Automatic enrollment was temporarily switched off to avoid repeatedly
searching the 754 candidates absent from the complete API listing. The remaining
overlaps received targeted verification with the same full identity checks and
cohort cap. Collection/application of already verified files continues independently
of the automatic-enrollment setting.

Verification of the 45 numeric overlaps resulted in **42 verified real loans**, two
real loans held out because their portal and Arive originators did not match, and
the existing synthetic file. The two exceptions were **Jonathan Sims, 17375345**,
and **Erika Anguiano, 17655400**; no originator mismatch was bypassed.

At approximately **5:15:26 p.m. Pacific**, the protected handoff confirmed that
**TESTING TESTER, 17881588**, had transferred to the shared collector, preserving
its existing submission packages and history. That brought the enabled generalized
cohort to **43 files: 42 real loans and one synthetic test file**. The first whole
43-file refresh was queued at approximately **5:16 p.m.**

The next status check confirmed **43 of 43 collected and applied**, with the latest
successful update at **5:20:04 p.m. Pacific** and the oldest at **5:01:28**. Every
enabled file had now completed at least one collection/application. Because the
oldest timestamp predates the whole-cohort queue request, these counts alone do not
establish that all 43 completed that requested pass or a full second pass. Repeat
validation remained pending after the worker scheduling correction.

After the scheduling fix reached Ready, another cohort refresh was queued at
approximately **5:20:45 p.m. Pacific**. Existing queued requests retained their
original timestamps. By a later check, the latest successful update had advanced to
**5:24:09**, but the oldest remained **5:07:29**. The queue and five-minute backoffs
created before the correction had not all cleared; a full second cycle was still
not established by those timestamps.

Two further production checks confirmed the shared-worker results in the normal
portal workflow:

- The main Processing search for **Mariana Lamb, 17750057**, showed **FUNDING** and
  **Funded**, whereas the earlier complete visibility inspection placed the existing
  portal record in **PIPELINE**. This is a visible real-loan routing result, not just
  an administrative preview.
- After handoff, **TESTING TESTER** showed a generalized collection at **5:20:02 p.m.**
  followed by the same successful application timestamp, confirming a completed
  shared-worker read/application while preserving the existing package.

The final fresh status confirmed **43 of 43 collected and applied**, with the oldest
successful update at **5:22:45 p.m. Pacific** and the latest at **5:31:30**. Every
enabled file's successful timestamp was later than the first 43-file completion
checkpoint of **5:20:04**. This establishes a complete repeat application across all
43 files, including TESTING TESTER after its shared-collector handoff. The old
scheduling-error backlog no longer prevented any member from completing another
successful cycle. The accepted cohort is **42 real loans plus one synthetic test**;
an actual 50-file cohort was not tested because only 43 files passed verification.

At approximately **5:32 p.m. Pacific**, the controls were saved with **All eligible
verified loans** selected and **automatic enrollment on**, while **collection and
application remained on**. The saved operator ceiling remained **120 requests per
minute**, not an Arive-confirmed quota. The all-cohort setting permits future
eligible files only after they independently pass the existing verification checks;
it does not override the **754-record API visibility gap** or the **two originator
mismatches**.

The requested 30–60-second freshness was not met in these observations. The repeat
whole-cohort pass took approximately 11 minutes, including the queue and old retry
backlog; this is not a steady-state throughput benchmark. Earlier active-file
background updates were approximately two minutes apart. The deadline correction
resolved the observed artificial failure-backoff case, but further scheduling and
throughput tuning is needed before making a 30–60-second freshness claim. The
operator cap was not increased to 300 or 600, and these checks do not establish
Arive's provider allowance or the performance of all 799 candidates.

### Missing-loan access comparison, November 12, 2026

The protected production diagnostic added in `de28571` completed at **5:56:58 p.m.
Pacific** (2026-11-13 01:56:58 UTC). It used the same encrypted saved connection,
shared request budget, and concurrency controls as canonical sync. It performed
six loan GET requests and one fresh authentication request, with no changes to
enrollment, source loan teams, credentials, or loan values.

- Control `GET /api/loans/17881588`: **200**, exact loan ID matched.
  Request ID `45453336-f3f6-43e0-b34c-144704788f09`.
- Missing target `GET /api/loans/17981070`: **403**.
  Request ID `81af871c-2351-4180-9b2b-e906eea11013`.
- Target `DISPLAY_ID` search: **200**, count 0, rows 0, complete page.
  Request ID `54e6551d-b44c-4853-8d7f-22436e45010e`.
- Target `BORROWER_NAME` search using its existing portal name: **200**, count 0,
  rows 0, complete page. Request ID `ac9c2921-fa92-4081-9ca7-0d0a45ee146c`.
- Fresh `POST /api/auth/access-token`: **201**.
  Request ID `e52a6066-e8f4-4fbe-bcc7-b43072090215`.
- Target numeric detail with that fresh token: **403**.
  Request ID `5427e9fd-b84c-4caf-9c44-1eb78874278a`.
- Target `DISPLAY_ID` search with the fresh token: **200**, count 0, rows 0,
  complete page. Request ID `835a5957-04ca-4d5f-b902-d6bc9635c84c`.

No target GUID lookup was attempted because no exact target search row supplied
one. Numeric detail support was confirmed by the synthetic control. The missing
record is visible in Arive's browser as **Jarrid Aquila, 17981070**, with primary LO
Mo Daneshfar; its visible loan team did not include Matt. A previously API-visible
comparison, **Bridger Burt, 17911176**, also has Mo as primary LO but includes Matt
as a secondary LO. This is evidence for a user/loan-team visibility restriction,
not proof of Arive's internal permission rule. Arive must trace the request IDs
and confirm the saved credential's actor, branch scope, and loan-team restrictions.
Browser admin visibility is not evidence of equivalent API visibility.

The test rules out an expired cached token and a general failure to authenticate
for this comparison. It confirms a loan-specific API denial for the known missing
target. It does not prove that every absent portal record has the same cause;
originator mismatches and incorrect or missing loan numbers remain separate issues.
There is no evidence supporting a direct-numeric fallback that would recover this
target, and no access check or matching rule was bypassed.

The new Admin III interface is `compareAriveLoanAccess({ loanNumber })`, limited to
one uniquely identified existing portal pipeline loan. It permits at most eight
loan reads and two authentications per invocation, once per five minutes. It
returns only HTTP metadata, counts, and identity booleans. Credential rotation
stops the comparison; transient failures and incomplete checks are marked partial.

### New-submission discovery

Automatic enrollment now reserves up to five candidates per invocation for the
newest eligible pipeline rows without an enrollment record. These candidates
alternate with the existing cursor lane, share its 100-row total and time budget,
and never advance the cursor themselves. Duplicate candidates are verified once.
This covers normal JR completion, completed self-processing submissions, and
import-created pipeline rows without adding Arive calls to task transactions.

This removes the need for a newly submitted row to wait for a full UUID cursor
wrap. It does not guarantee enrollment in 30–60 seconds: API access, request
capacity, scheduler timing, identity verification, and provider indexing still
apply. A failed identity/access check remains quarantined under existing retry
rules. Full active-pipeline rollout is blocked until missing-file access and
matching exceptions are resolved and the expanded cohort passes acceptance.
