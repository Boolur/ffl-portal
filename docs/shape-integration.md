# Shape lead delivery

Implemented using the existing integration-service dispatcher, assignment triggers, credential editor and dispatch logs. Bonzo continues to operate independently.

## Setup

1. Set the server-only `SHAPE_API_KEY` to the complete raw authorization key from Shape Settings → Apps & Integrations → API Integrations. Do not add a Bearer prefix or place this key in service templates.
2. Run `node --env-file=.env src/scripts/setupShape.mjs` to review the live Shape roster. Run again with `--apply` to create the disabled service and verified user credentials. It matches unique emails, falling back to unique exact names, and verifies department membership. Existing conflicting mappings are preserved for review.
3. Alternatively, use Admin → Lead Services → New service → Shape. The preset starts disabled. Set each officer’s Shape user ID in Admin → Lead Users.
4. Deploy the code, confirm the key and user mappings, then enable the Shape service. Use a controlled test lead to verify the Shape record and officer assignment before broad rollout.

## Behavior and mapping

The company endpoint is `https://secure-api.setshape.com/api/add/new/lead/25977` using POST JSON. Borrower first name, last name and email are required. Missing fields, missing credentials and invalid Shape user IDs prevent the request and appear in dispatch logs.

The payload uses `firstname`, `lastname`, `email`, `recordtype: 3`, `mstrstatus1: New Lead`, and the officer’s `shapeUserId` in their configured department field. `shapeAssignmentField` defaults to `depursLi` (Loan Officer); the live roster also uses `depursLo` (CLR) and `depursAa` (Administration). Shape silently ignores a user assigned through the wrong department, so matching department membership is essential. The portal ID is sent as `mktentryid` (Customer Entry ID); it is not sent as Shape’s own lead ID. Campaign name, falling back to vendor name, supplies `source`.

The October 13 MarketingSourceFields attachment supplies phone, mailing address, subject property and credit-score field names. Shape calls home phone `mobilePhone`, while `phone` is mobile phone. The primary number falls back to home then work. Per Alexander's October 20 correction, loan amount is sent as `LoanAmount` and loan purpose as `qkapppurpose`, preserving the portal values. Loan type and term remain in notes pending further mapping. SSN, date of birth and the remaining Bonzo fields are not part of this initial payload.

An empty body uses the built-in mapping. Optional JSON body fields merge into that mapping; identity, entry ID, record type and assigned officer remain controlled by the portal. Templates are rendered as JSON values to preserve quotes and newlines.

Success requires HTTP 2xx and a positive `recordId` in the response. The preset captures `recordId` into `Lead.customData.shapeRecordId`. Authorization is redacted from dispatch logs and redirects are rejected. No automatic retry is performed: inspect ambiguous responses and timeouts in Shape before manually retrying to avoid duplicates. Shape documents a 15-minute block on identical request bodies, not permanent idempotency.

Live vendor distribution and ordinary assignment use existing ON_ASSIGN triggers. Manual Push to Service also supports Shape. CSV imports require the separate, opt-in Shape checkbox and the canonical service slug `shape`; historical imports remain off by default.

## Remaining rollout work

The live API setup verified 43 of 47 users, including department fields. Four Shape roster entries still have no unique portal match: Spencer Simmons (127), Nicolette Poivre (115), Joey Moscatiello (79), Eva Bryant (7). Confirm identities before adding mappings.

October 13 live validation: the API key authenticated successfully and was saved as a Vercel Production Secret. Synthetic DNC test records 444 (Loan Officer, Nick Yebisu, `depursLi:3`) and 447 (CLR, Brenden Crane, `depursLo:40`) were created through the real portal dispatcher, recorded in ServiceDispatch, and read back through Shape's search API. Test 441 demonstrated that an Administration user cannot be assigned via `depursLi`, prompting the department-aware mapping. Test emails use `example.invalid` and contain no real borrower information. These labeled test records are retained for audit; they should not be contacted.

Production deployment and activation must finish before automatic forwarding is operational. Shape-to-portal status updates are a separate phase: Alexander still needs an agreed callback payload and authentication method. No inbound Shape endpoint or two-way status sync is implemented by this change. Arive access and embedding are also separate from outbound lead distribution.

References: Alexander’s October 13 posting email and field CSV; [Shape Add Leads API](https://setshape.com/api-docs/add-a-record). The public API documentation confirms source names are optional and the creation receipt contains `recordId`, resolving the Marketing Source CSV’s source-ID requirement for this Open API endpoint.
