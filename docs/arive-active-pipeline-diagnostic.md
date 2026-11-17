# Read-only active pipeline access diagnostic

Admin III → Arive Integration → **Active pipeline access check** verifies every unarchived `PIPELINE` record captured at the start. Restructures and Fundings are intentionally outside this check. The maximum cohort is 1,000 files; an oversized cohort is rejected rather than silently truncated.

## Operation

- Start captures record IDs, versions, loan numbers, and an opaque hash of the current identity. It does not enroll files or send Arive requests until the UI explicitly continues the run.
- Each continuation processes at most five files. It searches by exact `DISPLAY_ID`, follows the returned permanent GUID, and applies the existing numeric ID/GUID/originator/borrower verification to search and detail responses.
- Invalid loan numbers, duplicate portal numbers, registered practice files, missing exact API matches, malformed responses, identity disagreements, and HTTP access failures have distinct outcomes. An empty search means **not visible through this connection**, not “deleted in Arive.” The existing synthetic test is counted separately.
- Source identities are compared before each chunk and again before saving its results. Results whose portal source subsequently changes are displayed as requiring review. The screen reports active files added or moved since capture.
- Closing the page or selecting Pause stops scheduling more chunks. Saved progress can be resumed explicitly. Opening or refreshing the screen performs database reads only.
- A provider cooldown or budget deferral stops automatic continuation. Resume explicitly after the displayed retry time. Authentication failures, changed controls or credentials, revoked access, and lost leases invalidate the run safely.
- Export results produces a flat CSV with formula-safe cells. Only Admin III can retrieve results; client account/active-role changes clear cached results and stop subsequent work.

## Isolation and bounds

All collection, application, and enrollment controls must remain off, with no enabled sync records or active sync leases. Fresh authorization, control generation, credential revision, and the diagnostic lease are checked before every actual HTTP send, including authentication and token retries. The shared transport still enforces its global request budget, token coordination, cooldowns, and two-request concurrency limit.

The only writes are a dedicated `ARIVE_ACTIVE_PIPELINE_DIAGNOSTIC` AuditLog record with no loan association, and existing shared-transport token/request metadata. No Loan, ProcessingPipelineLoan, Task, ArivePipelineSync, note, attachment, payroll, notification, or PortalRevision is changed. No provider mutation endpoint is permitted; authentication POST and exact loan GETs are allowlisted.

Chunks have a 120-second deadline, 180-second lease, at most 16 actual GETs and two authentications. Runs expire after six hours, have conservative request reservations that survive crashes, and allow at most `max(32, 4 × cohort size + 20)` GETs and 20 authentications. Starting another run has a five-minute spacing; resuming existing progress does not reset its allowance. A single global diagnostic lease prevents overlapping chunks across operators/instances. Transactions never remain open during provider calls.

## Deployment and verification

No schema change or feature activation is needed. `npm run build` generates the Prisma client and compiles without migrations. Deploy only the diagnostic files and Admin III page integration; keep unrelated rollout documentation and settings unchanged.

Focused tests cover authorization, stale account roles, corrupt state, fixed-cohort/source changes, concurrent continuations, interrupted leases, credentials/control changes, budget deferral, 401 refresh, 403 versus identity failures, 429 cooldowns, CSV safety, and explicit client continuation. After the live run, independently compare synchronization controls, enabled/leased file counts, and `PROCESSING_ARIVE_SYNC_APPLIED` audit counts to the pre-run baseline.

This proves loan-search/detail visibility and identity compatibility at the recorded times. It does not activate syncing, prove outbound document permission, or guarantee that future loans will match without their own checks.
