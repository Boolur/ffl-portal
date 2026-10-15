# Processing submission pilot

The pilot provides stored document packages and Jr review for Matt Mahjoub, plus approved-document transfers and read-only Arive notes. It is available at `/pipeline/submission-pilot`, with links from Pipeline and Tasks. It is separate from the existing full intake form and does not replace that form for other users. No automatic loan-stage changes are included.

## Connect Arive and open a test loan

An Admin III opens Arive connection on the pilot page and enters company Client ID, Client secret, and API key. Test and save checks authentication and access to document classifications before saving. Credentials are encrypted with AES-256-GCM using a domain-separated key derived from the server NEXTAUTH_SECRET. No secret is returned to the client or written to audit logs. Rotating NEXTAUTH_SECRET requires re-entering the Arive credentials. The additive AriveIntegrationConfig migration is applied during the normal deployment build.

Matt enters the test Arive loan number under Open Arive loan. The lookup requires an exact unique display ID and an originator email matching Matt's portal account. It can create a minimal portal loan and document package for a new test loan without placing it into Processing. An existing Matt loan is reused and linked; another LO's portal record cannot be taken over. Use a loan file, not an unconverted Arive lead.

## Loan Officer flow

Only the verified active LO account `2e28c6a5-67c0-442d-94bd-59897ad8d8cd` can start or edit a package. The same-name onboarding account is excluded. Matt selects an existing loan where he is the primary LO and the processing row is active in Pipeline or Restructures. Existing processing method and assignments are retained.

The six categories follow the current Jr checklist: mortgage documents, homeowners insurance, income, identification, veteran documentation, and signed initial disclosures. Upload applicable files or provide an explanation for an inapplicable category. Explanations require Jr approval. Additional documents have their own labeled categories. Files are PDFs, JPGs, or PNGs up to 20 MB each, with up to 10 files per category and 30 categories per package.

Drafts persist. Submission requires every required category to have files or an explanation, at least one actual document, and no unfinished upload or unresolved correction. Submitted packages are locked to LO edits until returned.

## Jr Processor flow

Jr Processors see submitted packages in the pilot review queue and receive an in-app notification. A Jr must claim a package before reviewing it. Another Jr cannot take it over. Processing managers and admins may inspect assigned reviews but cannot edit them without owning the claim.

The reviewer downloads each file, approves the category or explanation, or enters a required correction reason. Return Corrections routes the package back to Matt and notifies him. He replaces the affected files or changes explanations and resubmits. Changed categories require fresh review; approvals on untouched categories remain. Prior removed file metadata and storage objects are retained. The current UI displays the history but does not offer restoration of retired files.

Approval is permitted only after every applicable category is approved. The package becomes a completed task and notifies Matt. Approval makes transfers available but does not claim the files have been sent.

## Document transfers and notes

After approval, load the current company classifications. Select a classification for each file, or explicitly leave automatic classification selected, then choose Send to Arive. The additional-document "unused" destination is not hardcoded or claimed to exist; use an actual returned classification when appropriate. The server reads the private BISU file, obtains Arive upload access, uploads bytes, and attaches the document. Borrower visibility is omitted, which the reference documents as not borrower-viewable. API credentials are never forwarded to the signed storage URL.

Each file records a durable transfer attempt and, on success, Arive's returned document ID. Repeated sends of successful files are blocked. A failure before attachment can be retried. An uncertain attachment response or interrupted sending attempt requires verification in Arive; it cannot be automatically replayed. This pilot has no administrator reset/reconciliation interface yet. These safeguards favor avoiding duplicate documents over automatic recovery.

Refresh notes imports the complete paginated loan-note list, up to a 5,000-note pilot limit, with authors, dates, and replies. Notes also refresh every 60 seconds while the selected package is visible and the UI is not busy. No background cron or note webhook is claimed. A failed or incomplete read retains the previous successful snapshot. Imported text is rendered as text rather than trusted HTML. Prefix parsing into pipeline fields is not included in this pilot.

## Storage and task behavior

Packages use dedicated generic Task records with server-controlled submission data, separate from existing Submit to Processing tasks. The pilot uses a dedicated queue linked from the task page rather than adding packages to existing specialized Jr buckets. This avoids completing an existing processing task or moving a loan during the document pilot.

Private storage uses the existing task-attachments bucket. Signed uploads are authorized per package; finalization verifies stored size and MIME metadata. Downloads require current account and package authorization and use five-minute signed links. Pilot files are not ordinary TaskAttachment records, so legacy attachment removal does not remove approved package files. Upload cancellation can leave an unreferenced object; automatic storage cleanup is not implemented in this version.

Package changes use revision checks, a per-task transaction lock, an additional task updatedAt check, and an audit entry. Generic task completion and note updates cannot bypass the pilot workflow. Removing an approved package through existing admin task deletion remains an administrative action; file cleanup is separate.

## Validation and launch

Run `npx vitest run src/lib/submissionPilot.test.ts src/app/actions/submissionPilotActions.test.ts`, `npx tsc --noEmit --incremental false`, and targeted ESLint checks for the new files. Automated tests cover required items, upload limits, unresolved corrections, approval gates, account restrictions, claim ownership, stale revisions, and the correction/resubmission round trip.

The configured storage bucket was confirmed available and private on October 15, 2026. No real borrower files were uploaded during implementation. Live Arive acceptance requires company credentials and a test loan: connect as Admin III, open the test loan as Matt, submit and approve a document package through a Jr account, send one file, and verify its presence and borrower privacy in Arive. Add a note in Arive, refresh notes in BISU, and verify its author and text. Verify corrections, notifications, reload persistence, and denial of access for another LO. Confirm legacy submissions still work for other users.

Automated tests additionally cover credential encryption, authentication headers, safe upload destinations, private attachment payloads, prevention of duplicate sends, ambiguous transfer responses, and preservation of notes after read failures. Credentials and live Arive response behavior still require the acceptance exercise above; mocked tests do not establish account provisioning.
