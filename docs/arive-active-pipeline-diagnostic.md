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

## Identity and import rules

The exact numeric Arive number and permanent GUID remain mandatory. An expected BISU primary or secondary loan officer may match Arive's primary originator or a member explicitly assigned the `Originator` role on that same loan. Assistant, processor, and other team roles do not qualify. A previously verified originator must remain both a current BISU loan officer and an Arive originator. These checks never reassign portal ownership.

Borrower matching accepts an exact normalized first-and-last name for either `Borrower` or `CoBorrower`; it does not use partial names or fuzzy matching. Arive search summaries may omit the loan team. The diagnostic can use the full detail response's team only when number, GUID, and primary-originator identity agree; contradictory summaries still fail.

MISMO import suggestions prioritize an explicitly identified Arive/LOS number over the filename. Universal and lender identifiers are not Arive identity. Conflicting or malformed explicit identities, timestamp-like identifiers, and ambiguous filenames leave the required number field empty for manual entry. This improves future import suggestions; it does not repair existing records automatically.

Historical number corrections require separately verified evidence and explicit authorization. Update only the selected canonical identifier and its existing operational references, retain a before/after audit, check for duplicates and concurrent edits, and keep collection, enrollment, and application disabled. Existing financial records and historical audits must remain unchanged. Rerun the read-only diagnostic after correction; a successful diagnostic does not enroll or activate the file.

## Targeted follow-up

After a completed check, **Investigate review items + new loans** starts a separate diagnostic audit. The server selects current review outcomes, source identities changed since the prior check, and newly active files. Earlier unchanged matches are retained in the prior report and do not consume new Arive requests. The caller supplies only the latest diagnostic run ID, never arbitrary loan identities. An active child run is returned on a repeated start; a stale parent is rejected.

Follow-ups preserve the original run ID and a cumulative baseline of captured identity hashes and carried matches. Repeated follow-ups therefore distinguish newly added files from earlier matches omitted from the smaller target cohort. A connection or control revision change requires a new full check; earlier matches cannot be carried into a different connection. Prior review files no longer active receive an explicit source-changed outcome without provider reads. All existing authorization, pause, lease, expiry, shared budget, cooldown, and read-only protections remain in force.

For diagnosis, follow-ups retain a bounded allowlist of identity evidence: portal and Arive loan numbers, permanent IDs, originator email addresses, borrower names, relevant loan-team roles, and other applicant roles. No full provider response, credentials, financial values, or document data is stored. An empty exact-number search can additionally receive a direct-number check and limited borrower-name search; invalid portal numbers can receive the latter. Search candidates are evidence only: they never become automatic matches, new links, or canonical loan updates. The admin table and CSV identify these differences explicitly, with HTTP status and safe request IDs for provider investigation.
