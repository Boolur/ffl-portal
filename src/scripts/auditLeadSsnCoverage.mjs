/**
 * Read-only audit for Lead.ssn coverage by vendor, campaign, and day.
 *
 * This script intentionally never prints SSN values. It only reports whether
 * the portal stored a usable SSN and whether the captured raw payload contained
 * usable, blank, placeholder, or missing SSN-like keys.
 *
 * Usage (PowerShell):
 *   node src/scripts/auditLeadSsnCoverage.mjs
 *   node src/scripts/auditLeadSsnCoverage.mjs --vendor lendingtree --days 30
 *   node src/scripts/auditLeadSsnCoverage.mjs --vendor lendingtree --months 4
 *   node src/scripts/auditLeadSsnCoverage.mjs --vendor lendingtree --sample 20
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
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[env] Could not read ${path}:`, err.message);
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));

const prisma = new PrismaClient();
const PLACEHOLDER_REGEX = '^\\{[A-Za-z0-9_]+\\}$';

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    vendor: 'lendingtree',
    days: 30,
    months: 4,
    sample: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--vendor') opts.vendor = String(args[++i] || '').toLowerCase();
    else if (arg === '--days') opts.days = parsePositiveInt(args[++i], opts.days);
    else if (arg === '--months') opts.months = parsePositiveInt(args[++i], opts.months);
    else if (arg === '--sample') opts.sample = parsePositiveInt(args[++i], 0);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        `Usage: node src/scripts/auditLeadSsnCoverage.mjs [--vendor <slug>] [--days N] [--months N] [--sample N]\n` +
          `  --vendor  vendor slug to audit (default: lendingtree)\n` +
          `  --days    look back this many days for campaign/day detail (default: 30)\n` +
          `  --months  number of monthly buckets to print (default: 4)\n` +
          `  --sample  print N recent missing rows with redacted SSN state only\n`
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return opts;
}

function pct(part, whole) {
  if (!whole) return '0.0%';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

function printRows(rows, columns) {
  if (rows.length === 0) {
    console.log('  (no rows)');
    return;
  }

  const widths = columns.map(({ key, label }) =>
    Math.max(
      label.length,
      ...rows.map((row) => String(row[key] ?? '').length)
    )
  );

  console.log(
    columns.map(({ label }, i) => label.padEnd(widths[i])).join('  ')
  );
  console.log(columns.map((_, i) => '-'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    console.log(
      columns
        .map(({ key }, i) => String(row[key] ?? '').padEnd(widths[i]))
        .join('  ')
    );
  }
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

  const totals = await prisma.$queryRaw`
    SELECT
      count(*)::int AS total,
      min(l."receivedAt") AS first_received_at,
      max(l."receivedAt") AS last_received_at,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NOT NULL
      )::int AS lead_ssn_present,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NULL
      )::int AS lead_ssn_missing,
      count(*) FILTER (WHERE l."rawPayload" ? 'ssn')::int AS raw_has_ssn_key,
      count(*) FILTER (
        WHERE nullif(trim(l."rawPayload"->>'ssn'), '') IS NOT NULL
          AND NOT ((l."rawPayload"->>'ssn') ~ ${PLACEHOLDER_REGEX})
      )::int AS raw_ssn_usable,
      count(*) FILTER (
        WHERE l."rawPayload" ? 'ssn'
          AND nullif(trim(l."rawPayload"->>'ssn'), '') IS NULL
      )::int AS raw_ssn_blank,
      count(*) FILTER (
        WHERE (l."rawPayload"->>'ssn') ~ ${PLACEHOLDER_REGEX}
      )::int AS raw_ssn_placeholder
    FROM "Lead" l
    WHERE l."vendorId" = ${vendor.id}
  `;

  const total = totals[0] ?? {};
  console.log(`\nSSN coverage audit: ${vendor.name} (slug=${vendor.slug})\n`);
  console.log(`All-time leads:             ${total.total ?? 0}`);
  console.log(
    `Received window:            ${
      total.first_received_at
        ? `${total.first_received_at.toISOString()} -> ${total.last_received_at.toISOString()}`
        : '(none)'
    }`
  );
  console.log(
    `Lead.ssn present:           ${total.lead_ssn_present ?? 0} (${pct(
      total.lead_ssn_present ?? 0,
      total.total ?? 0
    )})`
  );
  console.log(
    `Lead.ssn missing:           ${total.lead_ssn_missing ?? 0} (${pct(
      total.lead_ssn_missing ?? 0,
      total.total ?? 0
    )})`
  );
  console.log(`rawPayload.ssn usable:      ${total.raw_ssn_usable ?? 0}`);
  console.log(`rawPayload.ssn blank:       ${total.raw_ssn_blank ?? 0}`);
  console.log(`rawPayload.ssn placeholder: ${total.raw_ssn_placeholder ?? 0}`);
  console.log('');

  const byMonth = await prisma.$queryRaw`
    SELECT
      to_char(date_trunc('month', l."receivedAt"), 'YYYY-MM') AS month,
      count(*)::int AS total,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NOT NULL
      )::int AS present,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NULL
      )::int AS missing,
      count(*) FILTER (
        WHERE nullif(trim(l."rawPayload"->>'ssn'), '') IS NOT NULL
          AND NOT ((l."rawPayload"->>'ssn') ~ ${PLACEHOLDER_REGEX})
      )::int AS raw_usable,
      count(*) FILTER (
        WHERE l."rawPayload" ? 'ssn'
          AND nullif(trim(l."rawPayload"->>'ssn'), '') IS NULL
      )::int AS raw_blank
    FROM "Lead" l
    WHERE l."vendorId" = ${vendor.id}
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT ${opts.months}
  `;

  console.log(`Monthly coverage (recent ${opts.months} month bucket(s))`);
  printRows(
    byMonth.map((row) => ({
      ...row,
      present_pct: pct(row.present, row.total),
      missing_pct: pct(row.missing, row.total),
    })),
    [
      { key: 'month', label: 'Month' },
      { key: 'total', label: 'Total' },
      { key: 'present', label: 'Present' },
      { key: 'present_pct', label: 'Present %' },
      { key: 'missing', label: 'Missing' },
      { key: 'missing_pct', label: 'Missing %' },
      { key: 'raw_usable', label: 'Raw usable' },
      { key: 'raw_blank', label: 'Raw blank' },
    ]
  );
  console.log('');

  const byCampaign = await prisma.$queryRaw`
    SELECT
      coalesce(c."routingTag", 'UNASSIGNED') AS routing_tag,
      coalesce(c.name, 'Unassigned') AS campaign,
      count(*)::int AS total,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NOT NULL
      )::int AS present,
      count(*) FILTER (
        WHERE nullif(trim(coalesce(l.ssn, '')), '') IS NULL
      )::int AS missing,
      count(*) FILTER (
        WHERE nullif(trim(l."rawPayload"->>'ssn'), '') IS NOT NULL
          AND NOT ((l."rawPayload"->>'ssn') ~ ${PLACEHOLDER_REGEX})
      )::int AS raw_usable,
      count(*) FILTER (
        WHERE l."rawPayload" ? 'ssn'
          AND nullif(trim(l."rawPayload"->>'ssn'), '') IS NULL
      )::int AS raw_blank
    FROM "Lead" l
    LEFT JOIN "LeadCampaign" c ON c.id = l."campaignId"
    WHERE l."vendorId" = ${vendor.id}
      AND l."receivedAt" >= now() - (${opts.days}::text || ' days')::interval
    GROUP BY 1, 2
    ORDER BY total DESC, routing_tag
  `;

  console.log(`Campaign coverage (last ${opts.days} day(s))`);
  printRows(
    byCampaign.map((row) => ({
      ...row,
      present_pct: pct(row.present, row.total),
      missing_pct: pct(row.missing, row.total),
    })),
    [
      { key: 'routing_tag', label: 'Routing tag' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'total', label: 'Total' },
      { key: 'present', label: 'Present' },
      { key: 'present_pct', label: 'Present %' },
      { key: 'missing', label: 'Missing' },
      { key: 'missing_pct', label: 'Missing %' },
      { key: 'raw_usable', label: 'Raw usable' },
      { key: 'raw_blank', label: 'Raw blank' },
    ]
  );
  console.log('');

  const ssnLikeKeys = await prisma.$queryRaw`
    WITH keys AS (
      SELECT key, l."rawPayload"->>key AS value
      FROM "Lead" l, jsonb_object_keys(l."rawPayload") AS key
      WHERE l."vendorId" = ${vendor.id}
        AND l."receivedAt" >= now() - (${opts.days}::text || ' days')::interval
        AND (
          lower(key) LIKE '%ssn%'
          OR lower(key) LIKE '%social%'
          OR lower(key) LIKE '%tax%'
          OR lower(key) IN ('tin', 'tax_id', 'taxid', 'taxpayer_id')
        )
    )
    SELECT
      key,
      count(*)::int AS rows,
      count(*) FILTER (
        WHERE nullif(trim(value), '') IS NOT NULL
          AND NOT (value ~ ${PLACEHOLDER_REGEX})
      )::int AS usable_values,
      count(*) FILTER (WHERE nullif(trim(value), '') IS NULL)::int AS blank_values,
      count(*) FILTER (WHERE value ~ ${PLACEHOLDER_REGEX})::int AS placeholder_values
    FROM keys
    GROUP BY key
    ORDER BY rows DESC, key
  `;

  console.log(`SSN-like raw payload keys (last ${opts.days} day(s), values redacted)`);
  printRows(ssnLikeKeys, [
    { key: 'key', label: 'Key' },
    { key: 'rows', label: 'Rows' },
    { key: 'usable_values', label: 'Usable values' },
    { key: 'blank_values', label: 'Blank values' },
    { key: 'placeholder_values', label: 'Placeholder values' },
  ]);

  if (opts.sample > 0) {
    const sample = await prisma.$queryRaw`
      SELECT
        l.id,
        l."receivedAt",
        coalesce(c."routingTag", 'UNASSIGNED') AS routing_tag,
        coalesce(c.name, 'Unassigned') AS campaign,
        CASE
          WHEN NOT (l."rawPayload" ? 'ssn') THEN 'absent'
          WHEN nullif(trim(l."rawPayload"->>'ssn'), '') IS NULL THEN 'blank'
          WHEN (l."rawPayload"->>'ssn') ~ ${PLACEHOLDER_REGEX} THEN 'placeholder'
          ELSE 'usable'
        END AS raw_ssn_state
      FROM "Lead" l
      LEFT JOIN "LeadCampaign" c ON c.id = l."campaignId"
      WHERE l."vendorId" = ${vendor.id}
        AND nullif(trim(coalesce(l.ssn, '')), '') IS NULL
      ORDER BY l."receivedAt" DESC
      LIMIT ${opts.sample}
    `;

    console.log(`\nRecent missing Lead.ssn sample (values redacted, limit ${opts.sample})`);
    printRows(sample.map((row) => ({
      ...row,
      receivedAt: row.receivedAt.toISOString(),
    })), [
      { key: 'id', label: 'Lead ID' },
      { key: 'receivedAt', label: 'Received at' },
      { key: 'routing_tag', label: 'Routing tag' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'raw_ssn_state', label: 'Raw SSN state' },
    ]);
  }
}

main()
  .catch((err) => {
    console.error('[audit-lead-ssn-coverage] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
