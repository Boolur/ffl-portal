/**
 * Read-only audit: lists every "Broker Launch Notification" email the
 * noreply@ mailbox has sent, pulling from Microsoft Graph's Sent Items
 * folder. Source of truth for "did the email actually go out, and to whom?"
 *
 * Usage (PowerShell):
 *   node src/scripts/auditBrokerLaunchEmails.mjs
 *   node src/scripts/auditBrokerLaunchEmails.mjs 50       # top N (default 25)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[env] Could not read ${path}:`, err.message);
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));

const top = Number(process.argv[2] ?? 25);

const tenantId = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;
const senderEmail = process.env.MS_SENDER_EMAIL;

if (!tenantId || !clientId || !clientSecret || !senderEmail) {
  console.error('Missing Microsoft Graph env vars.');
  process.exit(1);
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: 'https://graph.microsoft.com/.default',
    client_secret: clientSecret,
    grant_type: 'client_credentials',
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );
  if (!res.ok) {
    throw new Error(
      `Graph token fetch failed: ${res.status} ${await res.text()}`
    );
  }
  const data = await res.json();
  return data.access_token;
}

const token = await getAccessToken();

// $filter on subject is case-sensitive exact-match; $search would broaden
// but Graph requires ConsistencyLevel: eventual for $search and the
// results are ordered by relevance not time. Filter + $orderby is the
// right call for an audit.
const url =
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}` +
  `/mailFolders/SentItems/messages` +
  `?$filter=${encodeURIComponent("subject eq 'Broker Launch Notification'")}` +
  `&$orderby=${encodeURIComponent('sentDateTime desc')}` +
  `&$top=${top}` +
  `&$select=${encodeURIComponent(
    'sentDateTime,toRecipients,subject,id'
  )}`;

const res = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
  console.error(`Graph query failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const messages = data.value ?? [];

console.log(
  `\nBroker Launch Notification emails sent from ${senderEmail}` +
    ` (showing up to ${top}, newest first):\n`
);

if (messages.length === 0) {
  console.log('  (none found)');
} else {
  const byRecipient = new Map();
  for (const m of messages) {
    const when = m.sentDateTime;
    const to = (m.toRecipients ?? [])
      .map((r) => r.emailAddress?.address ?? '')
      .filter(Boolean)
      .join(', ');
    console.log(`  ${when}  →  ${to}`);
    for (const r of m.toRecipients ?? []) {
      const addr = r.emailAddress?.address;
      if (!addr) continue;
      byRecipient.set(addr, (byRecipient.get(addr) ?? 0) + 1);
    }
  }

  console.log('\nBy recipient:');
  const rows = Array.from(byRecipient.entries()).sort((a, b) => b[1] - a[1]);
  for (const [addr, count] of rows) {
    console.log(`  ${count.toString().padStart(3)}  ${addr}`);
  }
}

console.log(`\nTotal in this page: ${messages.length}`);
if (data['@odata.nextLink']) {
  console.log(
    'More results exist — re-run with a larger $top to pull the full history.'
  );
}
