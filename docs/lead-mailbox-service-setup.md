# Lead Mailbox Service Setup Reference

Use this doc to build the 57 Lead Mailbox (LMB) Services that forward leads into the portal. Every LMB Service is one-to-one with a portal campaign, with its routing tag hardcoded into the JSON payload. No portal code changes are needed — all 57 campaigns and all 4 vendors are already seeded.

- **Total services to build:** 57 (18 LendingTree + 24 FreeRateUpdate + 14 LeadPoint + 1 Lendgo)
- **Strategy:** one LMB Service per portal campaign, with `routing_tag` baked in as a string literal
- **Source of truth for routing tags:** [src/scripts/seedLeadCampaigns.mjs](../src/scripts/seedLeadCampaigns.mjs)
- **Webhook endpoint:** [src/app/api/webhooks/lead-mailbox/[vendorSlug]/route.ts](../src/app/api/webhooks/lead-mailbox/%5BvendorSlug%5D/route.ts)
- **Field map:** [src/lib/leadMailboxBridge.ts](../src/lib/leadMailboxBridge.ts)

---

## 1. JSON Content template

Paste this into the **Content** field of every LMB Service you create. The **only** line you change per service is `routing_tag` — fill in the portal campaign's routing tag from the tables in section 3. Every placeholder below is either (a) accepted by the portal webhook's field map or (b) preserved as a note, so nothing in this template gets silently dropped.

> **Tip:** This is the exact same template produced by the **Copy JSON Template** button in Admin → Lead Vendors. Click the button instead of copy-pasting from the doc if you're already in the admin UI.

```json
{
  "lead_id": "{leadid}",
  "routing_tag": "",

  "first_name": "{firstname}",
  "last_name": "{lastname}",
  "email": "{email}",
  "number1": "{phonenumeric}",
  "number2": "{HomePhone}",
  "number3": "{WorkPhone}",
  "dob": "{dob}",
  "ssn": "{social}",

  "property_address": "{phys_address}",
  "property_city": "{phys_city}",
  "property_state": "{phys_state}",
  "property_zip": "{phys_zip}",
  "property_county": "{phys_county}",

  "property_value": "{property value}",
  "property_type": "{property type}",
  "property_use": "{property use}",
  "purchase_price": "{purchase price}",
  "property_ltv": "{Field_011}",

  "employer": "{employer}",
  "bankruptcy": "{bankruptcy}",
  "foreclosure": "{foreclosure}",
  "is_military": "{Ismilitary}",
  "custom_veteran": "{Veteran}",

  "loan_purpose": "{loan purpose}",
  "loan_amount": "{loan amount}",
  "loan_term": "{loan term}",
  "loan_type": "{loan type}",
  "loan_rate": "{Field_037}",
  "down_payment": "{down payment}",
  "cash_out": "{cash out}",

  "credit_rating": "{credit rating}",
  "current_balance": "{current balance}",
  "current_payment": "{current payment}",
  "current_rate": "{current rate}",

  "lead_created": "{createddash}",
  "user_id": "{user_002}",

  "notes": [
    "From Lead Mailbox",
    "Assigned LO: {User_Name} ({User_Email}) NMLS {User_License} — {User_Phone}",
    "Source campaign: {campaign_name}",
    "{lastnote}"
  ]
}
```

Key things to know:

- `routing_tag` starts empty (`""`) — you must fill it in per service with the value from the tables in section 3. The webhook falls back to the Unassigned Pool if it doesn't match.
- `lead_id` becomes the portal lead's `vendorLeadId` (for cross-referencing back to LMB).
- `property_ltv: "{Field_011}"` and `loan_rate: "{Field_037}"` reference numbered custom fields — these IDs are assigned per-customer in LMB's admin and match the ones configured for this org today. If an LMB admin renumbers a field, update it in [src/lib/leadMailboxBridge.ts](../src/lib/leadMailboxBridge.ts) and re-copy.
- LO info (`{User_Name}`, `{User_Email}`, `{User_License}`, `{User_Phone}`) and `{campaign_name}` have no home on the `Lead` model, so they're persisted as **notes** instead of getting dropped. `extractBridgeNotes` in [src/lib/leadMailboxBridge.ts](../src/lib/leadMailboxBridge.ts) auto-filters empty strings and unsubstituted `{Token}` placeholders.
- `is_military` and `custom_veteran` both land on the same `Lead.isMilitary` yes/no column — see the comment at lines 129-132 of [src/lib/leadMailboxBridge.ts](../src/lib/leadMailboxBridge.ts).

---

## 2. Webhook URLs per vendor

Each vendor has its own slug-based endpoint. Replace `{BASE_URL}` with your deployed portal origin (e.g. `https://portal.ffl.com`).

| Vendor | Webhook URL | Services to build |
|---|---|---|
| LendingTree | `POST {BASE_URL}/api/webhooks/lead-mailbox/lendingtree` | 18 |
| FreeRateUpdate | `POST {BASE_URL}/api/webhooks/lead-mailbox/freerateupdate` | 24 |
| LeadPoint | `POST {BASE_URL}/api/webhooks/lead-mailbox/leadpoint` | 14 |
| Lendgo | `POST {BASE_URL}/api/webhooks/lead-mailbox/lendgo` | 1 |
| **Total** |  | **57** |

### Auth headers

The webhook only enforces a shared secret if the vendor has `webhookSecret` set in the portal (see lines 51-58 of [src/app/api/webhooks/lead-mailbox/[vendorSlug]/route.ts](../src/app/api/webhooks/lead-mailbox/%5BvendorSlug%5D/route.ts)). If you set one in the portal's Vendor editor, add **one** of these to every LMB Service for that vendor:

```
x-webhook-secret: <the secret>
```

or

```
Authorization: Bearer <the secret>
```

If `webhookSecret` is blank, no header is required.

---

## 3. Campaign to routing-tag tables

Name each LMB Service something that mirrors the portal campaign name so you can audit the setup at a glance (e.g., `"Portal — Cali Retail FRU"`). Then paste the routing tag value into `PASTE_ROUTING_TAG_HERE` in the Content template.

### LendingTree — 18 services

Webhook: `POST {BASE_URL}/api/webhooks/lead-mailbox/lendingtree`

| Portal campaign name | Routing tag |
|---|---|
| (FFL07) HELOC/HELOAN Credit (620-699) 0-80LTVGradeB_DC | `928779` |
| (FFL07) HELOC/HELOAN Credit 620-699 \|0-80LTV(Grade B)ALL | `928780` |
| (FFL07) HELOC/HELOAN_Credit (700+) 0-80LTV(GRADE B) | `928732` |
| (FFL07) HELOC/HELOANCredit(620-699) 0-80LTV(GradeA) | `928781` |
| (FFL07) HELOC/HELOANCredit(700+)0-80 LTV(GradeB)_DC | `928778` |
| (FFL07) HELOC/HELOANCredit(700+)0-80LTV(Grade A) | `928782` |
| (FFL07) Refi \| Cash Out \| (600-699) Grade B | `928790` |
| (FFL07) Refi \| Cash Out \| 100-250k LA \| Grade A | `928795` |
| (FFL07) Refi \| Cash Out \| 100-250k LA \| Grade B | `928794` |
| (FFL07) Refi \| Cash Out \| 700+ Grade B | `928791` |
| (FFL07) VA C/O (600-699) Grade A | `928787` |
| (FFL07) VA C/O (600-699) Grade B | `928786` |
| (FFL07) VA C/O (700+) Grade A | `928788` |
| (FFL07) VA C/O (700+) Grade B | `928789` |
| (FFL07) VA_HE (700+) Grade A | `928784` |
| (FFL07) VA_HE (700+) Grade B | `928785` |
| (FFL07) VA_HE Credit (600-699) Grade A | `928783` |
| (FFL07) VA_HE Credit (600-699) Grade B | `928733` |

### FreeRateUpdate — 24 services

Webhook: `POST {BASE_URL}/api/webhooks/lead-mailbox/freerateupdate`

| Portal campaign name | Routing tag |
|---|---|
| Cali Retail - FRU | `califru` |
| FreeRateUpdate.com - Wolf | `fruwolf` |
| FRU - Alfredo Arreola | `fruaarreola` |
| FRU - Arya Ghafari | `ag-freerateupdate` |
| FRU - Chris Boulos | `frucboulos` |
| FRU - Daniel Botero | `frudbotero` |
| FRU - Ghadi Dib | `gd-freerateupdate` |
| FRU - Ivan Velev | `iv-freerateupdate` |
| FRU - Maral Mahjoub | `frumaralmahjoub` |
| FRU - Mikah Elgin | `me-freerateupdate` |
| FRU - Mo Daneshfar | `md-freerateupdate` |
| FRU - Pavi Kaur | `frupkaur` |
| FRU - Peter Escaross | `frupescaross` |
| FRU - Tarek Ghossein | `tg-freerateupdate` |
| FRU - Tyler Ferrier | `tf-freerateupdate` |
| FRU - Ziad Ghossein | `zgh-freerateupdate` |
| FRU - Zoe Gannam | `zg-freerateupdate` |
| FRU: Brooke Hancock | `frubhancock` |
| FRU: Chase Maza | `cmfru` |
| FRU: Grant Passman | `frugpassman` |
| FRU: Peter Perez | `ppfru` |
| FRU: Tarek Ghossein | `frutghossein` |
| FRU: Taylor Coulton | `frutaylorcoulton` |
| FRU: Thomas Knebelsberger | `frutknebelsberger` |

### LeadPoint — 14 services

Webhook: `POST {BASE_URL}/api/webhooks/lead-mailbox/leadpoint`

| Portal campaign name | Routing tag |
|---|---|
| Cali Retail - Leadpoint | `calileadpoint` |
| Lead Point - Ghadi Dib | `lpgdib` |
| Lead Point - Mikah Elgin | `lpmikahelgin` |
| Lead Point - Tarek Ghossein | `lptarekghossein` |
| Lead Point - Tyler Ferrier | `lptferrier` |
| Lead Point - Zoe Gannam | `lpzoegannam` |
| LeadPoint Premium | `leadpointpremium` |
| Leadpoint; Coulton Refi | `lpcoultonrefi` |
| LP - Pavi Kaur | `lppavikaur` |
| LP Team A Leads | `lpteama` |
| LP Team B Leads | `lpteamb` |
| LP:Chase Maza | `lpchasemaza` |
| LP:Denis Herrera | `lpdherrera` |
| LP:Peter Perez | `lppeterperez` |

> **Note:** The seed script also listed `LP:Tarek Ghossein` with the same routing tag `lptarekghossein` as `Lead Point - Tarek Ghossein`. Because routing tags are unique per vendor, only one was created — the table above matches the live DB. If you need both as distinct campaigns, rename one in the admin UI first (change its routing tag), then add the row here.

### Lendgo — 1 service

Webhook: `POST {BASE_URL}/api/webhooks/lead-mailbox/lendgo`

| Portal campaign name | Routing tag |
|---|---|
| Lendgo | `lendgo` |

---

## 4. Setup checklist

For each of the 57 campaigns, do:

1. In LMB, go to **Services → Create New**.
2. **Name the service** to mirror the portal campaign (e.g., `"Portal — Cali Retail FRU"`). This is just for your sanity while auditing.
3. **Method:** `POST`, **Content-Type:** `application/json`.
4. **URL:** the webhook for the vendor — copy from section 2.
5. **Headers:** add `x-webhook-secret: <secret>` **only** if that vendor has `webhookSecret` set in the portal.
6. **Content / Body:** paste the full JSON template from section 1 (or click **Copy JSON Template** in Admin → Lead Vendors to get the exact same template).
7. Fill in the empty `"routing_tag": ""` with the routing tag from section 3 (e.g., `"routing_tag": "califru"`).
8. **Link the service to the matching LMB campaign** (same binding you use today for whatever service currently handles that campaign).
9. Save.

Repeat 57 times. Plan ~45-90 minutes total depending on familiarity with LMB.

## 5. Test-lead verification

After building each vendor's batch (or all 57 at once), verify with **one test lead per vendor** — you don't need to test all 57:

1. In LMB, trigger a test push for a campaign under that vendor (use LMB's "Test Service" / "Resend" feature).
2. In the portal, go to **Admin → Leads** and filter by that vendor.
3. Confirm:
   - The lead appears within a few seconds
   - It's assigned to the **correct campaign** (not the Unassigned Pool)
   - The `vendorLeadId` field matches LMB's `LeadID`
   - LO info shows up in the **notes** section of the lead detail
4. If a lead lands in the Unassigned Pool, the `routing_tag` in that service's Content template doesn't match any active campaign for that vendor — re-check step 7 of the checklist.

## 6. What happens when a campaign is archived

The webhook explicitly ignores archived campaigns (lines 63-75 of [src/app/api/webhooks/lead-mailbox/[vendorSlug]/route.ts](../src/app/api/webhooks/lead-mailbox/%5BvendorSlug%5D/route.ts)): leads routed to an archived campaign fall through to the Unassigned Pool rather than getting rejected or resurfacing on the archived campaign. This means:

- You can safely pause traffic by archiving a portal campaign without touching the LMB Service.
- To fully turn a service off, disable it in LMB (archiving alone doesn't stop LMB from making the HTTP call — it just ensures the portal won't route it).

## 7. Field mapping appendix (what lands where)

Full map lives in [src/lib/leadMailboxBridge.ts](../src/lib/leadMailboxBridge.ts). Quick reference for the placeholders in the template:

| Payload key (template) | Portal `Lead` column |
|---|---|
| `lead_id` | `vendorLeadId` (handled separately, not in field map) |
| `first_name` / `last_name` / `email` | `firstName` / `lastName` / `email` |
| `number1` | `phone` |
| `number2` / `number3` | `homePhone` / `workPhone` |
| `dob` / `ssn` | `dob` / `ssn` |
| `property_address` / `property_city` / `property_state` / `property_zip` / `property_county` | `propertyAddress` / `propertyCity` / `propertyState` / `propertyZip` / `propertyCounty` |
| `property_value` / `property_type` / `property_use` / `property_ltv` / `purchase_price` | `propertyValue` / `propertyType` / `propertyUse` / `propertyLtv` / `purchasePrice` |
| `employer` / `bankruptcy` / `foreclosure` | `employer` / `bankruptcy` / `foreclosure` |
| `is_military` / `custom_veteran` | both write to `isMilitary` (single yes/no column) |
| `loan_purpose` / `loan_amount` / `loan_term` / `loan_type` / `loan_rate` / `down_payment` / `cash_out` | `loanPurpose` / `loanAmount` / `loanTerm` / `loanType` / `loanRate` / `downPayment` / `cashOut` |
| `credit_rating` | `creditRating` |
| `current_balance` / `current_payment` / `current_rate` | `currentBalance` / `currentPayment` / `currentRate` |
| `lead_created` | `leadCreated` |
| `user_id` | `vendorUserId` |
| `notes[]` | appended via `extractBridgeNotes` |
| `routing_tag` | used to look up the target campaign, not stored |

Any key in the JSON that isn't in `LEAD_MAILBOX_FIELD_MAP` is silently ignored — this is by design so that future placeholder additions don't need code changes to be safe. If you notice data appearing in LMB that's missing from the portal, check whether the payload key is in the map above.

---

# Bonzo forwarding (per-loan-officer outbound webhooks)

Once a lead lands in the portal and gets assigned to a loan officer, the portal immediately forwards that lead to the assigned LO's Bonzo account so it shows up in their Bonzo pipeline within seconds. Each LO owns their own Bonzo webhook URL; the URL is the routing key, there's no user_id to configure in the payload.

- **Forwarder:** [src/lib/bonzoForward.ts](../src/lib/bonzoForward.ts) (`forwardLeadToBonzo`)
- **Per-user URL:** `UserLeadQuota.bonzoWebhookUrl`, edited in Admin → Lead Users
- **Fire-and-forget:** a Bonzo outage or a bad URL never blocks lead distribution. Failures are logged server-side as `[bonzo] Forward error for lead <id> -> user <id>: ...`.
- **Timeout:** 10 s per POST.

## 8. How to install a Bonzo webhook URL for an LO

1. In Bonzo, go to **Account Settings → Event Hooks** (or create a Campaign and pull its inbound webhook URL from the Zapier/API tab — whichever your Bonzo plan exposes).
2. Copy the full URL, e.g. `https://app.getbonzo.com/webhook/abc123-def456`.
3. In the FFL Portal, go to **Admin → Lead Users → (the LO) → Edit**.
4. Paste the URL into the **Bonzo Webhook URL** field and click **Save**.
5. Click **Send test** next to the URL. You should see a green `200 OK - Bonzo accepted the test prospect "Test Bonzo"` badge within a second or two, and a test prospect named "Test Bonzo" should appear in that LO's Bonzo account. You can safely delete the test prospect in Bonzo.
6. If you see a red badge instead, the URL is wrong or Bonzo rejected the payload. The badge shows the HTTP status and a short excerpt from Bonzo's response body to help debug. Common causes:
   - **404 Not Found** — URL was truncated or the webhook was deleted in Bonzo. Re-copy it.
   - **401/403** — the URL works but requires an auth token Bonzo didn't embed. Regenerate the URL in Bonzo.
   - **Network error** — URL is malformed or behind a firewall.

Once **Send test** is green, real leads will route to that LO's Bonzo the instant they're assigned by the portal. No additional configuration.

## 9. Canonical JSON we POST to Bonzo

Every POST to a Bonzo webhook has this shape (built by `buildBonzoPayload` in `src/lib/bonzoForward.ts`). Fields with no data on the Lead come through as `null`; Bonzo ignores nulls.

```json
{
  "lead_id": "<portal Lead.id>",
  "lead_source": "<campaign name>",
  "application_date": "YYYY-MM-DD",
  "1_Status": "NEW",

  "first_name": "...",
  "last_name": "...",
  "email": "...",
  "phone": "...",
  "work_phone": "...",
  "birthday": "...",
  "ssn": "...",

  "address": "<borrower mailing street>",
  "city": "<borrower mailing city>",
  "state": "<borrower mailing state>",
  "zip": "<borrower mailing zip>",

  "property_address": "<subject property street>",
  "property_city": "...",
  "property_state": "...",
  "property_zip": "...",
  "property_county": "...",
  "property_type": "...",
  "property_use": "...",
  "property_value": "...",
  "purchase_price": "...",

  "loan_purpose": "...",
  "loan_amount": "...",
  "loan_type": "...",
  "loan_program": "<loan term>",
  "loan_balance": "<current balance>",
  "interest_rate": "<current rate>",
  "down_payment": "...",
  "cash_out_amount": "...",
  "credit_score": "...",

  "bankruptcy_details": "...",
  "foreclosure_details": "...",
  "custom_ismilitary": "...",
  "custom_veteran": "...",

  "prospect_company": "<employer>",
  "company_name": "<employer>",
  "occupation": "<job title>",
  "income": "...",
  "household_income": "...",

  "co_first_name": "...",
  "co_last_name": "...",
  "co_email": "...",
  "co_phone": "...",
  "co_birthday": "...",

  "notes": [
    "From FFL Portal",
    "Vendor: <vendor name>",
    "Campaign: <campaign name> (routing_tag: <tag>)",
    "Assigned LO: <user name> <user@email>",
    "...any LeadNote entries..."
  ]
}
```

## 10. Lead -> Bonzo field mapping

| Portal `Lead` column | Bonzo key | Notes |
|---|---|---|
| `id` | `lead_id` | |
| `campaign.name` | `lead_source` | Falls back to `vendor.name` if no campaign matched |
| `receivedAt` (UTC) | `application_date` | Formatted as `YYYY-MM-DD` |
| `status` | `1_Status` | Custom Bonzo field (prefix-numbered for sorting) |
| `firstName` / `lastName` / `email` / `phone` | `first_name` / `last_name` / `email` / `phone` | |
| `workPhone` | `work_phone` | |
| `dob` | `birthday` | Bonzo uses "birthday", not "dob" |
| `ssn` | `ssn` | |
| `mailingAddress` / `mailingCity` / `mailingState` / `mailingZip` | `address` / `city` / `state` / `zip` | Borrower mailing address |
| `propertyAddress` / `propertyCity` / `propertyState` / `propertyZip` / `propertyCounty` | `property_address` / `property_city` / `property_state` / `property_zip` / `property_county` | Subject property |
| `propertyType` / `propertyUse` / `propertyValue` / `purchasePrice` | `property_type` / `property_use` / `property_value` / `purchase_price` | |
| `loanPurpose` / `loanAmount` / `loanType` / `downPayment` | `loan_purpose` / `loan_amount` / `loan_type` / `down_payment` | |
| `loanTerm` | `loan_program` | Bonzo reuses "loan_program" for the term/product |
| `currentBalance` | `loan_balance` | |
| `currentRate` | `interest_rate` | |
| `cashOut` | `cash_out_amount` | |
| `creditRating` | `credit_score` | |
| `bankruptcy` | `bankruptcy_details` | |
| `foreclosure` | `foreclosure_details` | |
| `isMilitary` | `custom_ismilitary` | Bonzo custom field |
| `vaStatus` | `custom_veteran` | Bonzo custom field |
| `employer` | `prospect_company`, `company_name` | Mirrored to both keys since Bonzo admins sometimes surface one vs. the other |
| `jobTitle` | `occupation` | |
| `income` | `income`, `household_income` | Mirrored until we capture a separate household figure |
| `coFirstName` / `coLastName` / `coEmail` / `coPhone` | `co_first_name` / `co_last_name` / `co_email` / `co_phone` | |
| `coDob` | `co_birthday` | |
| `LeadNote.content` + routing meta | `notes` (array) | First entry is always `"From FFL Portal"`, followed by vendor/campaign/LO breadcrumbs, then up to 10 recent `LeadNote` entries |

**Not forwarded** (no Bonzo-native key; would pollute the prospect view in Bonzo): `propertyLtv`, `otherBalance`, `otherPayment`, `targetRate`, `vaLoan`, `fhaLoan`, `currentLender`, `currentPayment`, `currentTerm`, `currentType`, `propertyAcquired`, `homeowner`, `sourceUrl`, `price`. Some of these do get surfaced in the `notes[]` array (LTV, loan term, source URL, lead price) so nothing critical is lost.

**`user_id` is intentionally not sent.** Each LO has their own Bonzo webhook URL, and the URL itself identifies the destination Bonzo sub-user. Sending `user_id` would be redundant and risks overriding Bonzo's URL-based routing.

## 11. When does forwarding happen?

`forwardLeadToBonzo` is called from exactly the spots in [src/app/actions/leadActions.ts](../src/app/actions/leadActions.ts) where a lead picks up (or changes) an `assignedUserId`:

- Default-user fallback (no eligible round-robin members).
- Round-robin assignment to the next active member.
- Manual assign from the Unassigned Pool.
- Manual reassign (one lead or bulk).
- Default-user reassign (admin override).

Each call fires after the DB write commits, so if the assignment fails, Bonzo isn't hit. If Bonzo is slow or down, the forward aborts at 10 s but the lead stays assigned in the portal — admins can retry later by reassigning the lead, which triggers the forward again.
