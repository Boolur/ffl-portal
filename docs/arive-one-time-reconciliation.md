# Reviewed Arive reconciliation

The Admin III page at `/admin/arive/reconciliation` applies the seven explicitly reviewed identifier corrections from November 19, 2026. It cannot select arbitrary loans, enroll a cohort, enable background work, or write to Arive.

The reviewed mappings live in a private database record. Source control contains only that record's opaque reference and integrity digest; all tests use synthetic borrower identities. Preparation and application both validate the private scope, and a prepared plan cannot be replayed against a changed mapping.

Preparation reads each exact Arive number, its permanent identity, loan details, trackers, complete notes and details again through the existing shared request budget. The reviewed borrower, property and portal originator must match. Preparation records an encrypted, administrator-bound plan; it does not change workflow records.

Application accepts only that plan and its digest within fifteen minutes of the read. A serializable transaction rechecks current administrator access, connection revision, paused controls, source versions, duplicate identifiers, task references and financial records. The transaction changes the allowlisted loan facts, pipeline services/routing, safe application snapshot, notes and exact task loan-number references. Other task content, assignments, revenue values, payroll requests and splits stay unchanged. The audit records before/after field values and identifier references.

Both global synchronization controls and individual corrected files remain paused. A saved verified snapshot remains available through existing pilot permissions. Standard-mode users see the corrected canonical fields but retain existing editing permissions while synchronization is paused.

Missing or invalid Arive data does not erase existing canonical values. The review lists retained values when relevant. Existing funded-history protections and populated payment dates remain in force. Unknown or contradictory routing indicators require review rather than automatic movement.

The fixed manifest and original versions make this a bounded correction, not a reusable general-purpose overwrite endpoint. Repeated application of the same plan is idempotent. A changed source or a second plan after completion cannot overwrite the corrected file again.

Validation: focused planner, identity, notes, routing and server-action tests; TypeScript; ESLint; `npm run build` (compilation only, no implicit migration). Production verification compares the seven records, ten task references and protected payroll/assignment hashes against the independent preflight.
