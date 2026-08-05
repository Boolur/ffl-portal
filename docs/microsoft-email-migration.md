# Microsoft 365 Email Migration Runbook

This runbook moves portal mail from the legacy Microsoft 365 tenant to
functional `@bisuhomeloans.com` senders. The portal continues to use Microsoft
Graph app-only authentication; it does not use SMTP or a licensed user account.

## 1. Domain and DNS

1. In Microsoft 365 Admin Center, open **Settings > Domains > Add domain** and
   verify `bisuhomeloans.com` with the TXT value Microsoft provides.
2. Check the domain's current MX host before changing mail routing. Add the
   Exchange Online MX and Autodiscover records shown by the wizard only when
   the organization is intentionally moving inbound `@bisuhomeloans.com` mail
   to the new tenant. Domain verification and Graph outbound sending do not by
   themselves require an MX cutover.
3. Publish one SPF TXT record. If the domain already has SPF, merge
   `include:spf.protection.outlook.com` into that record instead of adding a
   second SPF record.
4. In Microsoft Defender, open **Email authentication settings > DKIM**, copy
   the two generated selector CNAME records into DNS, and enable DKIM after
   they resolve.
5. Publish a DMARC TXT record at `_dmarc.bisuhomeloans.com`. Start with
   `p=none` and aggregate reporting, review reports, then progress to
   `quarantine` and `reject`.

Do not copy tenant-specific DKIM or MX values from another environment.
Microsoft generates the authoritative values for the new tenant.

## 2. Shared mailboxes

Create these shared mailboxes in Exchange Admin Center:

- **BISU Portal** — `noreply@bisuhomeloans.com`
- **BISU Leads** — `leads@bisuhomeloans.com`
- **BISU Disclosures** — `disclosures@bisuhomeloans.com`
- **BISU Originations** — `originations@bisuhomeloans.com`
- **BISU Processing** — `processing@bisuhomeloans.com`

Shared mailboxes do not normally require licenses while they remain under
50 GB and do not use licensed retention, archive, or compliance features.
Hide each mailbox from address lists. After outbound tests pass, create an
Exchange mail-flow rule that rejects messages addressed to these five
recipients with an explanation that the address is automated and not
monitored. This makes the send-only behavior explicit instead of silently
accepting replies.

Create a mail-enabled security group named `BISU Portal Email Senders` and add
the five shared mailboxes as direct members. Direct membership matters because
the Exchange management scope below does not expand nested groups.

## 3. Entra application and scoped Exchange permission

1. Register a single-tenant Entra application named `BISU Portal Mailer`.
2. Record its Application (client) ID, Directory (tenant) ID, and the
   Enterprise Application service-principal Object ID. The Object ID from the
   App Registration overview is a different object and must not be used.
3. Create a client secret, record it once, and set an expiry/rotation reminder.
4. Do not grant organization-wide Microsoft Graph `Mail.Send` when using the
   Exchange RBAC assignment below. Entra consent and Exchange RBAC grants are
   additive; retaining both would defeat mailbox scoping.
5. Connect to Exchange Online PowerShell as an Exchange administrator and run:

```powershell
Connect-ExchangeOnline

$appId = "<application-client-id>"
$servicePrincipalObjectId = "<enterprise-application-object-id>"
$group = Get-DistributionGroup -Identity "BISU Portal Email Senders"

New-ServicePrincipal `
  -AppId $appId `
  -ObjectId $servicePrincipalObjectId `
  -DisplayName "BISU Portal Mailer"

New-ManagementScope `
  -Name "BISU Portal Email Senders Scope" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '$($group.DistinguishedName)'"

New-ManagementRoleAssignment `
  -Name "BISU Portal Mail.Send" `
  -Role "Application Mail.Send" `
  -App $servicePrincipalObjectId `
  -CustomResourceScope "BISU Portal Email Senders Scope"
```

Allow time for Exchange permission propagation, then confirm every intended
mailbox is in scope and an employee mailbox is not:

```powershell
Test-ServicePrincipalAuthorization `
  -Identity $servicePrincipalObjectId `
  -Resource leads@bisuhomeloans.com

Test-ServicePrincipalAuthorization `
  -Identity $servicePrincipalObjectId `
  -Resource employee@bisuhomeloans.com
```

The first result must show `Application Mail.Send` with `InScope = True`; the
second must not.

The optional `auditBrokerLaunchEmails.mjs` script reads Sent Items and therefore
needs `Application Mail.Read`. Prefer a separate audit app with the same
mailbox scope and store its credentials as `MS_AUDIT_*`; the production mailer
should remain send-only.

## 4. Vercel Preview validation

Set these variables in the Vercel Preview environment:

```text
MS_TENANT_ID=<new tenant ID>
MS_CLIENT_ID=<BISU Portal Mailer client ID>
MS_CLIENT_SECRET=<new secret>
MS_SENDER_NOREPLY_EMAIL=noreply@bisuhomeloans.com
MS_SENDER_LEADS_EMAIL=leads@bisuhomeloans.com
MS_SENDER_DISCLOSURES_EMAIL=disclosures@bisuhomeloans.com
MS_SENDER_ORIGINATIONS_EMAIL=originations@bisuhomeloans.com
MS_SENDER_PROCESSING_EMAIL=processing@bisuhomeloans.com
MS_REQUIRE_CATEGORY_SENDERS=true
```

Keep `MS_SENDER_EMAIL` only while testing backward compatibility. A Preview
deployment must send:

1. an account invite or password reset from `noreply@`;
2. a Broker Launch preview from `leads@`;
3. a disclosure or QC event from `disclosures@`;
4. a +1 broadcast from `originations@`; and
5. a JR/VA/processing event from `processing@`.

Test delivery to Microsoft 365, Gmail, and a loan-officer mailbox. For each
message verify the visible From address, BISU display name, portal links,
inline logo, SPF/DKIM/DMARC alignment, Sent Items, and Exchange message trace.
Also attempt a Graph send as an employee mailbox and confirm it receives 403.

## 5. Production cutover and rollback

1. Deploy the sender-routing code while production still has the legacy
   `MS_SENDER_EMAIL`; all categories will fall back to it.
2. Update recipient allowlists and Broker Launch rules that match the legacy
   From address.
3. At a low-volume time, set all new tenant and category variables in
   Production, set `MS_REQUIRE_CATEGORY_SENDERS=true`, and redeploy once.
4. Repeat the five production smoke tests and review the portal Email
   diagnostics page plus Exchange message trace.
5. Retain the old tenant credentials and mailbox securely for 30 days. To roll
   back, restore the old `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`,
   and `MS_SENDER_EMAIL`; remove all five `MS_SENDER_*_EMAIL` category
   variables; disable strict category senders; and redeploy. Category values
   take precedence over the legacy fallback even when strict mode is off.
6. During the window, monitor notification outbox failures, service dispatch
   failures, Graph 401/403/429 responses, and DMARC aggregate reports.
7. After 30 healthy days, revoke the legacy app secret and remove the fallback
   `MS_SENDER_EMAIL` from Vercel.

Microsoft references:

- [RBAC for Applications in Exchange Online](https://learn.microsoft.com/exchange/permissions-exo/application-rbac)
- [Shared mailboxes](https://learn.microsoft.com/microsoft-365/admin/email/about-shared-mailboxes)
- [SPF](https://learn.microsoft.com/defender-office-365/email-authentication-spf-configure)
- [DKIM](https://learn.microsoft.com/defender-office-365/email-authentication-dkim-configure)
- [DMARC](https://learn.microsoft.com/defender-office-365/email-authentication-dmarc-configure)
