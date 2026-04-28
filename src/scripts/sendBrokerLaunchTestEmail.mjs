/**
 * One-off: send a "Broker Launch Notification" email to a given recipient
 * using the exact template produced by src/lib/brokerLaunchEmail.ts, so
 * admins can preview what LOs will receive before flipping distribution on.
 *
 * Usage (PowerShell):
 *   node src/scripts/sendBrokerLaunchTestEmail.mjs mmahjoub@federalfirstlending.com
 *
 * Uses MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_SENDER_EMAIL
 * from .env, same as the live sendEmail helper. Sends a preview populated
 * with the reference "Sandra Curtis" payload from the LMB screenshot so
 * the email matches the format LO quoting tools were trained on.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tiny .env loader so this script doesn't need a dotenv dependency.
// Matches the subset of .env syntax the portal's .env actually uses
// (KEY=VALUE, ignoring `#` comments and empty lines).
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

const recipient = process.argv[2] || 'mmahjoub@federalfirstlending.com';

const tenantId = process.env.MS_TENANT_ID;
const clientId = process.env.MS_CLIENT_ID;
const clientSecret = process.env.MS_CLIENT_SECRET;
const senderEmail = process.env.MS_SENDER_EMAIL;

if (!tenantId || !clientId || !clientSecret || !senderEmail) {
  console.error(
    'Missing Microsoft Graph env vars (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET / MS_SENDER_EMAIL).'
  );
  process.exit(1);
}

// Reference lead that matches the LMB screenshot the Loan Officers' quoting
// tools were trained on. Field names mirror the Lead model in
// prisma/schema.prisma so the template renderer below can stay a verbatim
// copy of buildBrokerLaunchEmailBody in src/lib/brokerLaunchEmail.ts.
const sampleLead = {
  firstName: 'Sandra',
  lastName: 'Curtis',
  email: 'sc484498@gmail.com',
  phone: '7754335675',
  dob: '12/3/1981',
  mailingAddress: '420 S Horse Loop',
  mailingCity: 'Mc Dermitt',
  mailingState: 'NV',
  mailingZip: '89421',
  propertyAddress: null,
  propertyCity: 'Mc Dermitt',
  propertyState: 'NV',
  propertyZip: '89421',
  propertyType: 'SINGLEFAMDET',
  propertyUse: 'OWNEROCCUPIED',
  propertyValue: '350000',
  propertyLtv: '0',
  loanPurpose: 'HELOC HOMEIMP',
  loanAmount: '80000',
  loanType: null,
  cashOut: '80000',
  creditRating: '679',
  currentBalance: '0',
  currentRate: '',
  price: '19',
  vendor: { name: 'Test Vendor' },
  campaign: {
    name: 'FFL07 HELOC Grade B',
    routingTag: 'FFL07HELOC/HELOANCredit620-699|0-80LTV(Grade B)ALL',
  },
};

/**
 * Keep this function in lock-step with buildBrokerLaunchEmailBody in
 * src/lib/brokerLaunchEmail.ts. Any format drift will cause the preview
 * to disagree with what real leads actually send, which would defeat the
 * point of the preview.
 */
function buildBody(lead) {
  const campaignLabel =
    lead.campaign?.routingTag || lead.campaign?.name || lead.vendor.name;

  const mailAddress = lead.mailingAddress ?? lead.propertyAddress;
  const mailCity = lead.mailingCity ?? lead.propertyCity;
  const mailState = lead.mailingState ?? lead.propertyState;
  const mailZip = lead.mailingZip ?? lead.propertyZip;

  const lines = [];
  lines.push('Broker Launch Notification');
  lines.push('');
  lines.push(`Campaign = ${period(campaignLabel)}`);
  lines.push('');
  lines.push(`First Name = ${period(lead.firstName)}`);
  lines.push(`Last Name = ${period(lead.lastName)}`);
  lines.push(`Phone = ${period(formatPhone(lead.phone))}`);
  lines.push(`Email = ${bare(lead.email)}`);
  lines.push('');
  lines.push(`Address = ${period(mailAddress)}`);
  lines.push(`City = ${period(mailCity)}`);
  lines.push(`State = ${period(mailState)}`);
  lines.push(`Zip = ${period(mailZip)}`);
  lines.push('');
  lines.push(`PhysicalAddress = ${period(lead.propertyAddress)}`);
  lines.push(`Phys City = ${period(lead.propertyCity)}`);
  lines.push(`Phys State = ${period(lead.propertyState)}`);
  lines.push(`Phys Zip = ${period(lead.propertyZip)}`);
  lines.push('');
  lines.push(`Loan Purpose = ${period(lead.loanPurpose)}`);
  lines.push(`Loan Type = ${period(lead.loanType)}`);
  lines.push(`Property Use = ${period(lead.propertyUse)}`);
  lines.push(`Property Type = ${period(lead.propertyType)}`);
  lines.push(`Credit Rating = ${period(lead.creditRating)}`);
  lines.push('CB = {addl_PrimaryMortgageBalance}');
  lines.push(`Property Value = ${bare(lead.propertyValue)}`);
  lines.push(`Current Balance = ${bare(lead.currentBalance)}`);
  lines.push(`Property LTV = ${bare(lead.propertyLtv)}`);
  lines.push('');
  lines.push(`Cash out = ${bare(lead.cashOut)}`);
  lines.push('HELOC = {addl_HomeEquityAddlCash}');
  lines.push(`Loan Amount = ${bare(lead.loanAmount)}`);
  lines.push('');
  lines.push('IsMilitary = {IsMilitary}.');
  lines.push('curentVALoan = {VA Loan}.');
  lines.push('currentFHALoan = {FHA Loan}.');
  lines.push('');
  lines.push(`Price = ${bare(lead.price)}`);
  lines.push('');
  lines.push('Purchase Agreement = .');
  lines.push('Found Home = .');
  lines.push('');
  lines.push(`Current Rate: ${bare(lead.currentRate)}`);
  lines.push(`DOB: ${bare(lead.dob)}`);

  return lines.join('\n');
}

function period(value) {
  const trimmed = (value ?? '').trim();
  return trimmed ? `${trimmed}.` : '.';
}

function bare(value) {
  return (value ?? '').trim();
}

function formatPhone(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D+/g, '');
  if (digits.length < 10) return String(raw).trim();
  const ten =
    digits.length === 11 && digits.startsWith('1')
      ? digits.slice(1)
      : digits.slice(0, 10);
  return `(${ten.slice(0, 3)})${ten.slice(3, 6)}-${ten.slice(6, 10)}`;
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
    throw new Error(`Graph token fetch failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function sendGraphMail({ to, subject, text }) {
  const token = await getAccessToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      senderEmail
    )}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Graph sendMail failed: ${res.status} ${await res.text()}`);
  }
}

const body = buildBody(sampleLead);

console.log('--- Broker Launch Notification preview ---');
console.log(body);
console.log('------------------------------------------');
console.log(`Sending to ${recipient} from ${senderEmail} ...`);

try {
  await sendGraphMail({
    to: recipient,
    subject: 'Broker Launch Notification',
    text: body,
  });
  console.log(`OK - delivered to ${recipient}.`);
} catch (err) {
  console.error('FAILED:', err.message);
  process.exit(1);
}
