# Arive processing integration decisions

Updated October 15, 2026 from the team's responses to the leadership worksheet. These decisions supersede earlier tentative answers where explicitly changed. This is a requirements record, not authorization to enable production synchronization. API capabilities and limitations are recorded in [Arive API reference](arive-api-reference.md).

The objective is to reduce duplicate entry while retaining portal assignments, accountability, and financial controls. Two workstreams are now requested: syncing the existing processing pipeline from Arive, and redesigning submission uploads with LO and Jr Processor review before sending documents to Arive. Whether the submission redesign belongs in the initial pilot remains open.

Latest direction: build a live submission workflow for Matt Mahjoub, rather than a simulated preview. The implementation is documented in [Processing submission pilot](submission-pilot.md): real stored packages and Jr review, with company API setup, approved-document transfers, and imported Arive notes. A new Arive test loan can be opened by its verified loan number. Live API acceptance awaits company credentials. The broader pipeline sync remains a separate workstream.

## Team responses by original question

1. **Editing:** Processors work in Arive for processing; Jr Processors can work in both systems. The exact set of Jr-editable portal fields needs definition. This does not imply Arive supports writes to every field.
2. **Pilot:** Start with a few users, including Matt Mahjoub, and current loans already in the pipeline. Do not expand intake automatically. Exact users, loan selection, and whether to freeze or grow the pilot roster remain open.
3. **Funding:** Automatically move funded loans to Fundings. Preserve portal payroll and revenue approval controls.
4. **Read-only API fields:** Edit borrower details and trackers in Arive, and display updates in the portal. Portal-specific fields remain editable here.
5. **Concurrent edits:** Arive wins. Flag changes made in the BISU Portal that differ from Arive and warn the user about the mismatch. Preserve enough change history to explain the discrepancy rather than silently discarding it.
6. **Service exceptions:** The response retains the tentative approach: show actual Arive progress separately from processor responsibility. Final confirmation is still appropriate because the supplied wording remains tentative.
7. **Assignments:** The Jr Processor assigns the processor in Arive when applicable. Portal assignment continues to follow the LO's selected processor and processing type. Do not infer automatic portal permission changes from an Arive processor change. Handling assignment mismatches remains open.
8. **Suspension and adverse:** Suspended in Arive moves a loan to Restructures. Adverse in Arive removes it from the active pipeline. Removal is not an instruction to delete records; exact adverse signals and restoration behavior need definition. Ordinary Arive archival was not separately answered.
9. **Service source:** For now use Arive title, payoff, appraisal, and insurance statuses until ServiceLink is fully integrated. A trailing TBD leaves future ServiceLink precedence unresolved.
10. **Ownership:** Arive owns loan trackers and Arive notes. The portal owns rate-lock requests and finalized payroll numbers. Other portal-specific activities retain existing ownership pending explicit changes.
11. **Notes display:** Show processor/Arive notes in borrower popups and relevant notes areas.
12. **Pending items:** Use a recognizable note prefix, proposed as `Pending Items:`, to identify pending-item content. Parsing, replacement, completion, and correction rules remain open.
13. **Submission documents:** Rebuild Submit to Processing so LOs upload individual submission items. Jr Processors check presence and accuracy; approved documents then go to Arive. Proposed sections: required documents mapped to Arive classifications, and additional documents mapped to an Arive "unused" destination. That destination is a team proposal, not a verified API classification. Integrate requests for correction and resubmission into the current task workflow.
14. **Stages:** Rebuild the display around Arive stages rather than retaining only the current portal labels. Portal-only approval/restructure states need a separate treatment.
15. **Trackers and warnings:** Pull all Arive trackers. Keep rate-lock requests in the portal; the manager records the lock in Arive. Preserve existing SLAs, colors, and overdue warnings. Which trackers appear as main-grid columns versus borrower details remains open.
16. **Additional structured notes:** Proposed prefixes are `Scheduled Signing:`, `Payoff Expiry:`, `Condition needed:`, `Pending items:`, `HOI expiration:`, `1004D:`, `Water inspection:`, and `Pest inspection:`. These are proposed conventions, not an approved parsing contract. Field meaning, date formats, and handling multiple entries remain open.
17. **Missing required data:** Show a red box when required information is blank while retaining the actual Arive stage. Define applicability so irrelevant optional blanks do not become errors. Accessible text should accompany color.
18. **Reminder dates:** Use actual Arive milestone dates.
19. **Rate-lock completion:** Clear the portal's outstanding rate-lock request when Arive confirms the lock.
20. **Human versus automated activity reports:** Defer reporting changes for now; the team considers this a last resort rather than part of the initial pilot.

## Original questions still awaiting answers

21. Which financial values may Arive update? Distinguish loan amount, projected revenue, compensation, and final revenue. Finalized payroll remains portal-owned per question 10.
22. Should Arive's actual first-payment date replace the calculated portal date?
23. Does Sixth Payment mean the sixth scheduled installment, six months after funding, or an early-payoff monitoring date?
24. What happens if a funded loan is later corrected or moved backward in Arive, particularly after payroll or reporting?
25. Who resolves uncertain or conflicting loan matches?
26. Should managers review existing-value differences before the first sync replaces agreed fields?
27. Which exact users and existing loans participate in the pilot? The small-pilot direction is answered; the roster and boundaries are not.
28. How quickly must each type of update appear, including notes that lack a documented notification event?
29. Who owns failed updates, retries, alerts, and unresolved differences?
30. What measurable outcomes and acceptance criteria define pilot success?

## Follow-up decisions introduced by these answers

### Structured notes

- Does the latest Pending Items note replace the entire list, or add to previous notes? How does a processor explicitly clear the list?
- Can one note contain several recognized sections? Should matching ignore capitalization and leading whitespace?
- What date format and timezone must processors use for signing and expiration dates? What happens with invalid or ambiguous dates?
- Are Condition needed, 1004D, and inspections lists of tasks, statuses, due dates, or free text? Which require new SLA rules?
- How should edited or deleted source notes affect extracted fields? Which authors are accepted? Preserve the original note and provenance alongside extracted values.

### Submission and approval

- Is the upload/review redesign part of the first sync pilot or a later phase?
- Which documents are required for each loan scenario, and which allow a waiver or N/A?
- Does Jr approval apply to individual documents or the complete package? When do approved documents transfer?
- How do rejection reasons, replacement versions, and partial approvals appear in LO and Jr task lists?
- Who can view uploaded documents in Arive? Verify classification and borrower visibility explicitly; the API documents an empty borrower-visibility array as visible to all borrowers.
- What happens when a document is approved but transfer fails, or an LO replaces a document already transferred?

### Workflow and access

- Which fields may Jr Processors edit in the portal, given the decision to edit API-read-only loan fields in Arive?
- How are portal-only restructure requests and approvals displayed alongside Arive stages?
- Does reversal of suspended/adverse status restore the loan automatically or require review? How does ordinary archival differ from adverse closure?
- Should an assignment mismatch alert a manager while retaining the LO-selected portal routing?
- Which of all available trackers belong in the grid, and which belong in borrower details? Existing SLAs should be preserved; new tracker SLAs require explicit definitions.

## Technical verification before rollout

Verify account scope, API limits, identifiers, webhook authentication and retry behavior, stage-history write semantics, date and null semantics, numeric lock-status meanings, and tracker event coverage. Notes have no dedicated documented change event, so automatic note import requires a reconciliation strategy. Confirm note identifiers and edit behavior, document classifications including the proposed unused destination, and approved upload visibility. No live API behavior is established solely by the documentation review.
