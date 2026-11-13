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

### Pilot button follow-up

The top bar now includes a Pilot on/off switch for server-authorized Admin I/II/III
accounts and Matt. Production enables only `PILOT_VIEW_ENABLED` for this switch;
the practice and generalized collection gates remain off. The preference persists
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
