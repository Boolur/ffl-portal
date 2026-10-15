# Processing submission pilot

This first implementation provides stored document packages and Jr review for Matt Mahjoub's current active processing loans. It is available at `/pipeline/submission-pilot` after deployment, with links from Pipeline and Tasks. It is separate from the existing full intake form and does not replace that form for other users. No new loan import, Arive connection, schema migration, or automatic loan-stage change is included.

## Loan Officer flow

Only the verified active LO account `2e28c6a5-67c0-442d-94bd-59897ad8d8cd` can start or edit a package. The same-name onboarding account is excluded. Matt selects an existing loan where he is the primary LO and the processing row is active in Pipeline or Restructures. Existing processing method and assignments are retained.

The six categories follow the current Jr checklist: mortgage documents, homeowners insurance, income, identification, veteran documentation, and signed initial disclosures. Upload applicable files or provide an explanation for an inapplicable category. Explanations require Jr approval. Additional documents have their own labeled categories. Files are PDFs, JPGs, or PNGs up to 20 MB each, with up to 10 files per category and 30 categories per package.

Drafts persist. Submission requires every required category to have files or an explanation, at least one actual document, and no unfinished upload or unresolved correction. Submitted packages are locked to LO edits until returned.

## Jr Processor flow

Jr Processors see submitted packages in the pilot review queue and receive an in-app notification. A Jr must claim a package before reviewing it. Another Jr cannot take it over. Processing managers and admins may inspect assigned reviews but cannot edit them without owning the claim.

The reviewer downloads each file, approves the category or explanation, or enters a required correction reason. Return Corrections routes the package back to Matt and notifies him. He replaces the affected files or changes explanations and resubmits. Changed categories require fresh review; approvals on untouched categories remain. Prior removed file metadata and storage objects are retained. The current UI displays the history but does not offer restoration of retired files.

Approval is permitted only after every applicable category is approved. The package becomes a completed task and notifies Matt. Its label explicitly says that Arive transfer is not connected; approval never claims the files were sent.

## Storage and task behavior

Packages use dedicated generic Task records with server-controlled submission data, separate from existing Submit to Processing tasks. The pilot uses a dedicated queue linked from the task page rather than adding packages to existing specialized Jr buckets. This avoids completing an existing processing task or moving a loan during the document pilot.

Private storage uses the existing task-attachments bucket. Signed uploads are authorized per package; finalization verifies stored size and MIME metadata. Downloads require current account and package authorization and use five-minute signed links. Pilot files are not ordinary TaskAttachment records, so legacy attachment removal does not remove approved package files. Upload cancellation can leave an unreferenced object; automatic storage cleanup is not implemented in this version.

Package changes use revision checks, a per-task transaction lock, an additional task updatedAt check, and an audit entry. Generic task completion and note updates cannot bypass the pilot workflow. Removing an approved package through existing admin task deletion remains an administrative action; file cleanup is separate.

## Validation and launch

Run `npx vitest run src/lib/submissionPilot.test.ts src/app/actions/submissionPilotActions.test.ts`, `npx tsc --noEmit --incremental false`, and targeted ESLint checks for the new files. Automated tests cover required items, upload limits, unresolved corrections, approval gates, account restrictions, claim ownership, stale revisions, and the correction/resubmission round trip.

The configured storage bucket was confirmed available and private on October 15, 2026. No real borrower files were uploaded during implementation. Authenticated browser acceptance and deployment are still required: Matt should upload a test package, a Jr should return one correction, Matt should resubmit it, and the Jr should approve it. Verify notifications, reopen the package after refresh, and confirm another LO cannot access it. Confirm legacy submissions still work for other users.

Before Arive transfer is added, verify company credentials, loan identifiers, document classifications, the proposed additional-document destination, borrower visibility, and retry behavior. The pilot does not send financial documents externally.
