/**
 * Read-only audit for FreeRateUpdate (and optionally other LMB vendors)
 * Lead -> Bonzo mapping. Quantifies how many leads benefit from the
 * fixes that shipped alongside this script:
 *
 *   1. Bonzo `phone` fallback to homePhone / workPhone (commit
 *      following 3c9b82f — fixes FRU leads whose only number was
 *      populated as `{HomePhone}` / `number2` and was therefore being
 *      sent to Bonzo as `phone: null`).
 *
 *   2. Mailing-column split + ingest mirror: `mailing_*` payload keys
 *      now write to `Lead.mailing*` and the bridge mirrors them onto
 *      `property*` when property* is blank. This script reports how
 *      many FRU leads currently have `propertyAddress` populated vs
 *      blank, and of the blank ones, how many had a recoverable
 *      mailing-style key in the original `rawPayload` (i.e. would
 *      have come through correctly under the new field map / mirror).
 *
 *   3. loan_program / loan_term: prints the distribution of loanTerm
 *      and loanType so admins can sanity-check whether their Bonzo
 *      triggers should be keyed on `loan_program` (current default)
 *      or the new mirrored `loan_term` key.
 *
 * What this script does NOT do:
 *   - Re-push to Bonzo. Use the per-lead "Send test" admin action or
 *     the per-user webhook to replay specific leads after confirming
 *     the audit numbers look right.
 *   - Mutate any DB rows. (Run `backfillLeadAddresses.mjs --apply`
 *     separately if the audit shows recoverable addresses on old
 *     pre-fix leads.)
 *
 * Usage (PowerShell):
 *   node src/scripts/auditFruBonzoMapping.mjs
 *   node src/scripts/auditFruBonzoMapping.mjs --vendor freerateupdate --days 14
 *   node src/scripts/auditFruBonzoMapping.mjs --vendor lendingtree --limit 500
 *   node src/scripts/auditFruBonzoMapping.mjs --sample 5    # also print 5 example rows
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

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

const prisma = new PrismaClient();

// Mirror of address aliases in src/lib/leadMailboxBridge.ts (kept in sync
// with src/scripts/backfillLeadAddresses.mjs by inspection — same caveat
// applies). Used to detect leads whose rawPayload would have produced an
// address under the new field map but didn't under the old one.
const MAILING_KEYS = ['mailing_address', 'Mail_Address', 'mail_address'];
const PHYS_KEYS = ['phys_address', 'property_address', 'address'];

const UNSUBSTITUTED_PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

function normalizeStringValue(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  if (UNSUBSTITUTED_PLACEHOLDER.test(str)) return null;
  return str;
}

function findFirstValue(payload, keys) {
  if (!payload || typeof payload !== 'object') return null;
  const lookup = new Map();
  for (const [k, v] of Object.entries(payload)) {
    lookup.set(k, v);
    lookup.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const raw = lookup.has(key)
      ? lookup.get(key)
      : lookup.get(key.toLowerCase());
    const normalized = normalizeStringValue(raw);
    if (normalized !== null) return normalized;
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    vendor: 'freerateupdate',
    days: 7,
    limit: 200,
    sample: 0,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--vendor') opts.vendor = String(args[++i] || '').toLowerCase();
    else if (arg === '--days') opts.days = Number(args[++i] || 7);
    else if (arg === '--limit') opts.limit = Number(args[++i] || 200);
    else if (arg === '--sample') opts.sample = Number(args[++i] || 0);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node src/scripts/auditFruBonzoMapping.mjs [--vendor <slug>] [--days N] [--limit N] [--sample N]\n` +
          `  --vendor   vendor slug to audit (default: freerateupdate)\n` +
          `  --days     look back this many days (default: 7)\n` +
          `  --limit    max leads to inspect (default: 200)\n` +
          `  --sample   also print the first N example rows in detail\n`
      );
      process.exit(0);
    }
  }
  return opts;
}

function pct(part, whole) {
  if (!whole) return '0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs();
  const vendor = await prisma.leadVendor.findUnique({
    where: { slug: opts.vendor },
    select: { id: true, name: true, slug: true },
  });
  if (!vendor) {
    console.error(`No LeadVendor found with slug "${opts.vendor}".`);
    process.exit(1);
  }

  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: { vendorId: vendor.id, receivedAt: { gte: since } },
    orderBy: { receivedAt: 'desc' },
    take: opts.limit,
    select: {
      id: true,
      receivedAt: true,
      firstName: true,
      lastName: true,
      phone: true,
      homePhone: true,
      workPhone: true,
      coPhone: true,
      coHomePhone: true,
      coWorkPhone: true,
      propertyAddress: true,
      propertyCity: true,
      propertyState: true,
      propertyZip: true,
      mailingAddress: true,
      mailingCity: true,
      mailingState: true,
      mailingZip: true,
      loanType: true,
      loanTerm: true,
      rawPayload: true,
    },
  });

  if (leads.length === 0) {
    console.log(
      `No leads found for vendor "${vendor.slug}" in the last ${opts.days} day(s).`
    );
    return;
  }

  let phoneNull = 0;
  let phoneNullButRecoverable = 0;
  let coPhoneNull = 0;
  let coPhoneNullButRecoverable = 0;
  let propertyAddressBlank = 0;
  let propertyAddressBlankWithMailingColumn = 0;
  let propertyAddressBlankWithMailingPayload = 0;
  let propertyAddressBlankUnrecoverable = 0;

  const loanTermCounts = new Map();
  const loanTypeCounts = new Map();

  const samples = [];

  for (const lead of leads) {
    if (!lead.phone) {
      phoneNull += 1;
      if (lead.homePhone || lead.workPhone) phoneNullButRecoverable += 1;
    }
    if (!lead.coPhone) {
      // Only count co-borrower as "missing phone" when there's some
      // co-borrower data on the lead at all — otherwise every solo
      // borrower row inflates the denominator.
      const hasCoBorrower = Boolean(lead.coHomePhone || lead.coWorkPhone);
      if (hasCoBorrower) {
        coPhoneNull += 1;
        coPhoneNullButRecoverable += 1;
      }
    }

    if (!lead.propertyAddress) {
      propertyAddressBlank += 1;
      if (lead.mailingAddress) {
        propertyAddressBlankWithMailingColumn += 1;
      } else {
        const fromPayload = findFirstValue(lead.rawPayload, MAILING_KEYS);
        if (fromPayload) propertyAddressBlankWithMailingPayload += 1;
        else if (!findFirstValue(lead.rawPayload, PHYS_KEYS)) {
          propertyAddressBlankUnrecoverable += 1;
        }
      }
    }

    const lt = lead.loanType?.trim() || '(blank)';
    const lterm = lead.loanTerm?.trim() || '(blank)';
    loanTypeCounts.set(lt, (loanTypeCounts.get(lt) ?? 0) + 1);
    loanTermCounts.set(lterm, (loanTermCounts.get(lterm) ?? 0) + 1);

    if (samples.length < opts.sample) {
      samples.push(lead);
    }
  }

  console.log(
    `\nAudit: ${vendor.name} (slug=${vendor.slug}) — ${leads.length} leads in last ${opts.days}d\n`
  );

  console.log('Borrower phone (Bonzo `phone`):');
  console.log(`  phone == null:                     ${phoneNull} (${pct(phoneNull, leads.length)})`);
  console.log(
    `  ...recoverable via new fallback:   ${phoneNullButRecoverable} (${pct(phoneNullButRecoverable, leads.length)})`
  );
  console.log(
    `    -> these leads will now ship a real phone number to Bonzo via\n       phone ?? homePhone ?? workPhone (was: phone only).\n`
  );

  console.log('Co-borrower phone (Bonzo `co_phone`):');
  console.log(`  coPhone == null with other co-* set: ${coPhoneNull}`);
  console.log(
    `  ...recoverable via new fallback:     ${coPhoneNullButRecoverable}\n`
  );

  console.log('Property address (Bonzo `property_address` and the borrower-block fallback):');
  console.log(
    `  propertyAddress blank:                       ${propertyAddressBlank} (${pct(propertyAddressBlank, leads.length)})`
  );
  console.log(
    `    of those, mailingAddress already set:      ${propertyAddressBlankWithMailingColumn} -> mirror would fix them on next ingest`
  );
  console.log(
    `    of those, mailing_* in rawPayload only:    ${propertyAddressBlankWithMailingPayload} -> backfillLeadAddresses.mjs would recover`
  );
  console.log(
    `    truly unrecoverable (no address sent):     ${propertyAddressBlankUnrecoverable}\n`
  );

  console.log('Loan field distribution (sanity check for Bonzo loan_program / loan_term):');
  const top = (m, label) => {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`  Top ${label}:`);
    for (const [k, v] of sorted) {
      console.log(`    ${String(k).padEnd(28)} ${v}`);
    }
  };
  top(loanTypeCounts, 'loanType (Bonzo `loan_type`)');
  top(loanTermCounts, 'loanTerm (Bonzo `loan_program` + new `loan_term` mirror)');
  console.log('');

  if (samples.length > 0) {
    console.log(`Sample of ${samples.length} most recent leads:\n`);
    for (const s of samples) {
      const name = [s.firstName, s.lastName].filter(Boolean).join(' ') || '(no name)';
      console.log(`  • ${s.id}  ${name}  ${s.receivedAt.toISOString()}`);
      console.log(
        `      phone=${s.phone ?? '∅'}  home=${s.homePhone ?? '∅'}  work=${s.workPhone ?? '∅'}`
      );
      console.log(
        `      property=${s.propertyAddress ?? '∅'}, ${s.propertyCity ?? '∅'} ${s.propertyState ?? '∅'} ${s.propertyZip ?? '∅'}`
      );
      console.log(
        `      mailing= ${s.mailingAddress ?? '∅'}, ${s.mailingCity ?? '∅'} ${s.mailingState ?? '∅'} ${s.mailingZip ?? '∅'}`
      );
      console.log(`      loanType=${s.loanType ?? '∅'}  loanTerm=${s.loanTerm ?? '∅'}`);
      console.log('');
    }
  }
}

main()
  .catch((err) => {
    console.error('[audit-fru-bonzo] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
