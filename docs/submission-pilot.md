# Processing submission pilot

The pilot adds a fourth Documents step to Matt Mahjoub's existing Submit for Processing popup. The original MISMO, Processing Method, and Processing Details steps and dashboard card are preserved. Other accounts retain the three-step form. The separate `/pipeline/submission-pilot` page remains available for document review, corrections, approved-document transfers, and read-only Arive notes.

## Connect Arive and open a test loan

An Admin III opens Arive connection on the pilot page and enters company Client ID, Client secret, and API key. Test and save checks authentication and access to document classifications before saving. Credentials are encrypted with AES-256-GCM using a domain-separated key derived from the server NEXTAUTH_SECRET. No secret is returned to the client or written to audit logs. Rotating NEXTAUTH_SECRET requires re-entering the Arive credentials. The additive AriveIntegrationConfig migration is applied during the normal deployment build.

Matt enters the test Arive loan number under Open Arive loan. The lookup requires an exact unique display ID and an originator email matching Matt's portal account. It can create a minimal portal loan and document package for a new test loan without placing it into Processing. An existing Matt loan is reused and linked; another LO's portal record cannot be taken over. Use a loan file, not an unconverted Arive lead.

## Loan Officer flow

Only the verified active LO account `2e28c6a5-67c0-442d-94bd-59897ad8d8cd`, using the LO role, gets the fourth popup step. The server also enforces documents for that account's QC submissions. Matt must be the primary LO. The original form validation and processing routing remain in place. Documents are staged in private storage under a user-scoped prefix and checked for ownership, size, MIME type, duplicate paths, and checklist completeness before loan/request creation. The normal Processing request and its linked review package are created in the same transaction. No request is sent when merely continuing to Documents.

The popup's unsent form and checklist stay in browser memory; keep it open until submission. Closing it loses those selections, and unused uploaded objects currently require manual cleanup. The separate pilot page can still open persistent draft packages for existing active Matt pipeline loans, or a verified Arive loan.

The six categories follow the current Jr checklist: mortgage documents, homeowners insurance, income, identification, veteran documentation, and signed initial disclosures. Each has an icon drop target with keyboard-accessible browsing: red means required/missing, green means uploaded, and grey means Not Applicable. LOs can select Not Applicable and optionally add a reason; the selection is stored for Jr approval. Uploaded files must be removed before selecting Not Applicable. Additional documents accept a batch and create one editable label per file, initially based on its filename. Files are PDFs, JPGs, or PNGs up to 20 MB each, with up to 10 files per required category and 30 categories per package (up to 24 individually labeled additional files). Partial batch successes remain available if a later upload fails.

Saved packages persist after submission (and drafts created on the separate pilot page persist). Submission requires every required category to have files or an explanation, at least one actual document, and no unfinished upload or unresolved correction. Submitted packages are locked to LO edits until returned.

## Jr Processor flow

Jr Processors receive the normal Processing request notification. Uploaded documents and review controls appear inside the existing request popup. Opening it does not start the task: the normal Start action assigns the reviewer and enables document review. Reassigning the request also changes its document reviewer. Supporting document records are excluded from task queues and counts, preventing a second Started card. Standalone pilot-page packages retain their separate claim workflow. Processing managers and admins may inspect assigned reviews but cannot edit them without ownership.

Hover over or focus a filename to prepare dragging to a folder or supported upload area. Drag-out uses Chrome's DownloadURL format for desktop downloads and a File payload for compatible websites. Destination behavior varies; Download remains available. Prepared files stay in memory for one minute. Native desktop and third-party drop behavior requires manual browser acceptance testing.

The reviewer downloads each file, approves the category or explanation, or enters a required correction reason. Return Corrections routes the package back to Matt and notifies him. He replaces the affected files or changes explanations and resubmits. Changed categories require fresh review; approvals on untouched categories remain. Prior removed file metadata and storage objects are retained. The current UI displays the history but does not offer restoration of retired files.

Approval is permitted only after every applicable category is approved. The package becomes a completed task and notifies Matt. Approval makes transfers available but does not claim the files have been sent.

## Document transfers and notes

After approval, load the current company classifications. Select a classification for each file, or explicitly leave automatic classification selected, then choose Send to Arive. The additional-document "unused" destination is not hardcoded or claimed to exist; use an actual returned classification when appropriate. The server reads the private BISU file, obtains Arive upload access, uploads bytes, and attaches the document. Borrower visibility is omitted, which the reference documents as not borrower-viewable. API credentials are never forwarded to the signed storage URL.

Each file records a durable transfer attempt and, on success, Arive's returned document ID. Repeated sends of successful files are blocked. A failure before attachment can be retried. An uncertain attachment response or interrupted sending attempt requires verification in Arive; it cannot be automatically replayed. This pilot has no administrator reset/reconciliation interface yet. These safeguards favor avoiding duplicate documents over automatic recovery.

Refresh notes imports the complete paginated loan-note list, up to a 5,000-note pilot limit, with authors, dates, and replies. Notes also refresh every 60 seconds while the selected package is visible and the UI is not busy. No background cron or note webhook is claimed. A failed or incomplete read retains the previous successful snapshot. Imported text is rendered as text rather than trusted HTML. Prefix parsing into pipeline fields is not included in this pilot.

## Storage and task behavior

Packages use dedicated generic Task records with server-controlled submission data. Popup submissions store the package ID on the normal Processing request so the existing desk workflow and document review remain linked. Document approval controls Arive transfer eligibility; it does not automatically complete the normal Processing request. Existing processing-method behavior, including self-processed completion, is retained.

Private storage uses the existing task-attachments bucket. Signed uploads are authorized per package; finalization verifies stored size and MIME metadata. Downloads require current account and package authorization and use five-minute signed links. Pilot files are not ordinary TaskAttachment records, so legacy attachment removal does not remove approved package files. Upload cancellation can leave an unreferenced object; automatic storage cleanup is not implemented in this version.

Upload verification reads the storage SDK's current top-level `size` and `contentType`, falling back to legacy `metadata.size` and `metadata.mimetype` only when the current fields are absent. Both popup submission and pilot-page finalization use the same check. Missing files, size/type mismatches, incomplete metadata, and storage failures produce distinct errors; temporary verification failures do not discard pending uploads. On October 15, 2026, an opt-in integration test uploaded a synthetic PDF through a signed URL, passed it through the actual final submission validator, and removed the test object without creating a loan or task. Run that check with `RUN_STORAGE_UPLOAD_SMOKE=1` and `src/lib/processingSubmissionDocuments.integration.test.ts`; it reads local storage configuration and is skipped by default.

Package changes use revision checks, a per-task transaction lock, an additional task updatedAt check, and an audit entry. Generic task completion and note updates cannot bypass the pilot workflow. Removing an approved package through existing admin task deletion remains an administrative action; file cleanup is separate.

## Validation and launch

Run `npx vitest run src/lib/submissionPilot.test.ts src/app/actions/submissionPilotActions.test.ts`, `npx tsc --noEmit --incremental false`, and targeted ESLint checks for the new files. Automated tests cover required items, upload limits, unresolved corrections, approval gates, account restrictions, claim ownership, stale revisions, and the correction/resubmission round trip.

The configured storage bucket was confirmed available and private on October 15, 2026. No real borrower files were uploaded during implementation. Live Arive acceptance requires company credentials and a test loan: connect as Admin III, open the test loan as Matt, submit and approve a document package through a Jr account, send one file, and verify its presence and borrower privacy in Arive. Add a note in Arive, refresh notes in BISU, and verify its author and text. Verify corrections, notifications, reload persistence, and denial of access for another LO. Confirm legacy submissions still work for other users.

Automated tests additionally cover credential encryption, authentication headers, safe upload destinations, private attachment payloads, prevention of duplicate sends, ambiguous transfer responses, and preservation of notes after read failures. Credentials and live Arive response behavior still require the acceptance exercise above; mocked tests do not establish account provisioning.
