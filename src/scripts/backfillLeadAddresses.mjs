/**
 * Silent backfill for Lead rows where `propertyAddress` is null but the
 * original `rawPayload` contains recoverable address data under some
 * other alias (e.g. `mailing_address`, `Mail_Address`, `subject_property_
 * address`, …).
 *
 * Why this exists: before the "mailing fallback" change shipped in
 * commit 3c9b82f, LendingTree LMB services only sent `{phys_address}`
 * via the `property_address` JSON key. When LendingTree's lead had a
 * blank physical address but a valid mailing address, the blank string
 * persisted to `Lead.propertyAddress` and every downstream consumer
 * (Bonzo push, Broker Launch email, portal lead detail) showed blank.
 *
 * This script re-runs the Lead Mailbox bridge's address field map
 * against each null-address lead's stored `rawPayload` to see if any
 * alias key now holds a usable value. If so, it backfills all five
 * property* columns at once. If not, the lead is left untouched and
 * counted as "unrecoverable" in the summary so you can see how many
 * old leads are permanently blank.
 *
 * What this script does NOT do:
 *   - Re-send Broker Launch emails (those already went out; the inbox
 *     is a separate audit trail the user can't rewrite).
 *   - Re-push to Bonzo. If you want to mirror the backfill over to
 *     Bonzo so LOs' dashboards catch up, run a separate pass with a
 *     `forwardLeadToBonzo`-style script.
 *   - Touch any non-address fields.
 *
 * Usage (PowerShell):
 *   node src/scripts/backfillLeadAddresses.mjs            # dry run
 *   node src/scripts/backfillLeadAddresses.mjs --apply    # actually update
 *   node src/scripts/backfillLeadAddresses.mjs --apply --limit 50
 *   node src/scripts/backfillLeadAddresses.mjs --vendor lendingtree --apply
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

// Load .env so DATABASE_URL is available when running standalone.
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

// Mirror of src/lib/leadMailboxBridge.ts's address-related aliases. Kept
// in sync by inspection since .mjs scripts can't import from the .ts
// bridge directly. Add new aliases here if leadMailboxBridge.ts gains
// them. Order doesn't matter — we pick the first non-empty value per
// target column, same semantics as the webhook's first-match-wins.
const ADDRESS_ALIASES = {
  propertyAddress: [
    'property_address',
    'phys_address',
    'mailing_address',
    'Mail_Address',
    'mail_address',
    'subject_property_address',
    'address',
    'address_line_1',
    'street',
    'street_1',
    'street1',
  ],
  propertyCity: [
    'property_city',
    'phys_city',
    'mailing_city',
    'Mail_City',
    'mail_city',
    'subject_property_city',
    'city',
  ],
  propertyState: [
    'property_state',
    'phys_state',
    'mailing_state',
    'Mail_State',
    'mail_state',
    'subject_property_state',
    'state',
  ],
  propertyZip: [
    'property_zip',
    'phys_zip',
    'mailing_zip',
    'Mail_Zip',
    'mail_zip',
    'subject_property_zip',
    'zip',
    'zip_code',
    'postal_code',
  ],
  propertyCounty: [
    'property_county',
    'phys_county',
    'mailing_county',
    'Mail_County',
    'mail_county',
    'subject_property_county',
    'county',
  ],
};

// Matches an unsubstituted LMB placeholder like "{Mail_Address}" so we
// don't backfill literal tokens the vendor never filled in. Same regex
// the live webhook uses in src/lib/webhookIngest.ts.
const UNSUBSTITUTED_PLACEHOLDER = /^\{[A-Za-z0-9_]+\}$/;

function normalizeStringValue(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  if (UNSUBSTITUTED_PLACEHOLDER.test(str)) return null;
  return str;
}

// Pulls the first recoverable value from the payload for a given target
// column, tolerating both original-case and lowercased keys (some
// vendors upcase the first letter, e.g. "Mail_Address" vs "mail_address").
function findFirstValue(payload, keys) {
  if (!payload || typeof payload !== 'object') return null;
  const entries = Object.entries(payload);
  const lookup = new Map();
  for (const [k, v] of entries) {
    lookup.set(k, v);
    lookup.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const raw = lookup.has(key) ? lookup.get(key) : lookup.get(key.toLowerCase());
    const normalized = normalizeStringValue(raw);
    if (normalized !== null) return normalized;
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { apply: false, limit: 0, vendor: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--limit') opts.limit = Number(args[++i] || 0);
    else if (arg === '--vendor') opts.vendor = args[++i] || null;
  }
  return opts;
}

async function main() {
  const opts = parseArgs();

  // Only leads whose propertyAddress column is explicitly null are in
  // scope. Empty string leads (e.g. "") are included via the IS NULL
  // filter below only if we treat them as null — we don't. Empty
  // strings technically satisfy "has a value", but the webhook's
  // normalizeStringValue would have stored `null` for those. Anyone
  // on an older build who ended up with "" can be caught with a
  // follow-up pass; keeping this script focused on the canonical
  // null-address population.
  const where = {
    propertyAddress: null,
    ...(opts.vendor
      ? { vendor: { slug: opts.vendor.toLowerCase() } }
      : {}),
  };

  const total = await prisma.lead.count({ where });
  if (total === 0) {
    console.log('No leads with null propertyAddress found. Nothing to do.');
    return;
  }

  console.log(
    `Found ${total} lead(s) with null propertyAddress${
      opts.vendor ? ` for vendor "${opts.vendor}"` : ''
    }.`
  );

  const take = opts.limit > 0 ? opts.limit : total;

  const leads = await prisma.lead.findMany({
    where,
    select: {
      id: true,
      vendorLeadId: true,
      firstName: true,
      lastName: true,
      propertyCity: true,
      propertyState: true,
      propertyZip: true,
      propertyCounty: true,
      rawPayload: true,
      vendor: { select: { slug: true, name: true } },
      campaign: { select: { name: true, routingTag: true } },
      receivedAt: true,
    },
    orderBy: { receivedAt: 'asc' },
    take,
  });

  // Per-lead decisions: which payload keys we'd fill, which we'd skip.
  const recoverable = []; // { leadId, updates, sourceKeys }
  const unrecoverable = []; // { leadId, vendorSlug, reason }
  const vendorBreakdown = new Map(); // vendorSlug -> { total, recoverable }

  for (const lead of leads) {
    const vendorSlug = lead.vendor?.slug ?? '(unknown)';
    const stat = vendorBreakdown.get(vendorSlug) ?? {
      total: 0,
      recoverable: 0,
    };
    stat.total += 1;
    vendorBreakdown.set(vendorSlug, stat);

    const payload = lead.rawPayload;
    const found = {
      propertyAddress: findFirstValue(payload, ADDRESS_ALIASES.propertyAddress),
      propertyCity: findFirstValue(payload, ADDRESS_ALIASES.propertyCity),
      propertyState: findFirstValue(payload, ADDRESS_ALIASES.propertyState),
      propertyZip: findFirstValue(payload, ADDRESS_ALIASES.propertyZip),
      propertyCounty: findFirstValue(payload, ADDRESS_ALIASES.propertyCounty),
    };

    if (!found.propertyAddress) {
      unrecoverable.push({
        leadId: lead.id,
        vendorSlug,
        name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)',
        city: lead.propertyCity,
        state: lead.propertyState,
        zip: lead.propertyZip,
      });
      continue;
    }

    // Never overwrite a column that already holds a value. The
    // propertyAddress column is null by definition (that's our
    // filter), but propertyCity/State/Zip/County may already be
    // populated on historical leads — keep the existing value.
    const updates = {};
    if (found.propertyAddress) updates.propertyAddress = found.propertyAddress;
    if (found.propertyCity && !lead.propertyCity) {
      updates.propertyCity = found.propertyCity;
    }
    if (found.propertyState && !lead.propertyState) {
      updates.propertyState = found.propertyState;
    }
    if (found.propertyZip && !lead.propertyZip) {
      updates.propertyZip = found.propertyZip;
    }
    if (found.propertyCounty && !lead.propertyCounty) {
      updates.propertyCounty = found.propertyCounty;
    }

    recoverable.push({
      leadId: lead.id,
      vendorSlug,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)',
      updates,
    });
    stat.recoverable += 1;
  }

  // ---------- Summary ----------
  console.log('');
  console.log('=== Backfill candidates ===');
  console.log(`  Scanned:       ${leads.length}`);
  console.log(`  Recoverable:   ${recoverable.length}`);
  console.log(`  Unrecoverable: ${unrecoverable.length}`);

  console.log('');
  console.log('Per-vendor breakdown:');
  for (const [slug, stat] of [...vendorBreakdown.entries()].sort()) {
    console.log(
      `  ${slug.padEnd(24)}  ${stat.recoverable}/${stat.total} recoverable`
    );
  }

  if (recoverable.length > 0) {
    console.log('');
    console.log('Sample of leads that WILL be backfilled (first 10):');
    for (const r of recoverable.slice(0, 10)) {
      const addr = r.updates.propertyAddress ?? '(kept)';
      console.log(
        `  - ${r.leadId.slice(0, 8)}… | ${r.vendorSlug.padEnd(16)} | ${r.name.padEnd(28)} | ${addr}`
      );
    }
    if (recoverable.length > 10) {
      console.log(`  …and ${recoverable.length - 10} more.`);
    }
  }

  if (unrecoverable.length > 0) {
    console.log('');
    console.log(
      'Sample of leads we CANNOT recover (rawPayload has no usable address; first 10):'
    );
    for (const u of unrecoverable.slice(0, 10)) {
      const locale = [u.city, u.state, u.zip].filter(Boolean).join(', ') || '(no locale)';
      console.log(
        `  - ${u.leadId.slice(0, 8)}… | ${u.vendorSlug.padEnd(16)} | ${u.name.padEnd(28)} | ${locale}`
      );
    }
    if (unrecoverable.length > 10) {
      console.log(`  …and ${unrecoverable.length - 10} more.`);
    }
  }

  if (!opts.apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to write changes to the DB.');
    return;
  }

  if (recoverable.length === 0) {
    console.log('');
    console.log('Nothing recoverable to apply.');
    return;
  }

  // ---------- Apply ----------
  console.log('');
  console.log(`Applying backfill to ${recoverable.length} lead(s)…`);
  let updated = 0;
  let failed = 0;
  for (const r of recoverable) {
    try {
      await prisma.lead.update({
        where: { id: r.leadId },
        data: r.updates,
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.warn(
        `  ! Failed to update ${r.leadId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  console.log('');
  console.log(`Done. Updated ${updated} lead(s). Failed ${failed}.`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
