// One-off, idempotent setup for the BISU public website as a lead source.
//
//   node src/scripts/seedBisuWebsiteVendor.mjs            # dry run (default)
//   node src/scripts/seedBisuWebsiteVendor.mjs --apply    # write changes
//
// What it does:
//   1. Upserts a LeadVendor with slug "bisu-website". The webhook secret is
//      read from BISU_WEBSITE_WEBHOOK_SECRET (env); if unset, a random one is
//      generated and printed so you can paste it into the website's
//      PORTAL_WEBHOOK_SECRET env var.
//   2. Sets a fieldMapping so the generic webhook ingest
//      (/api/webhooks/leads/bisu-website) maps the website's JSON keys onto
//      Lead columns. BISU WebLeads intentionally do not use campaigns:
//      officer pages target an active published portal user directly, while
//      every other submission enters the unassigned pool.
//
// Re-running is safe: the vendor is upserted by slug. Existing legacy BISU
// campaigns are left untouched so they can be archived after cutover.

import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const VENDOR_SLUG = 'bisu-website';
const VENDOR_NAME = 'BISU Website';

// Website payload key -> Lead column. The website posts keys already named to
// match Lead fields, so this is largely identity; listing it explicitly keeps
// the contract obvious and lets us rename safely on either side.
const FIELD_MAPPING = {
  firstName: 'firstName',
  lastName: 'lastName',
  email: 'email',
  phone: 'phone',
  loanPurpose: 'loanPurpose',
  loanType: 'loanType',
  propertyType: 'propertyType',
  propertyUse: 'propertyUse',
  propertyState: 'propertyState',
  propertyCity: 'propertyCity',
  propertyZip: 'propertyZip',
  purchasePrice: 'purchasePrice',
  propertyValue: 'propertyValue',
  downPayment: 'downPayment',
  loanAmount: 'loanAmount',
  currentBalance: 'currentBalance',
  currentRate: 'currentRate',
  cashOut: 'cashOut',
  creditRating: 'creditRating',
  income: 'income',
  selfEmployed: 'selfEmployed',
  isMilitary: 'isMilitary',
  vaStatus: 'vaStatus',
  homeowner: 'homeowner',
  bankruptcy: 'bankruptcy',
  sourceUrl: 'sourceUrl',
};

async function upsertVendor(apply) {
  const existing = await prisma.leadVendor.findUnique({
    where: { slug: VENDOR_SLUG },
  });

  const secret =
    process.env.BISU_WEBSITE_WEBHOOK_SECRET ||
    existing?.webhookSecret ||
    randomBytes(24).toString('hex');

  if (existing) {
    console.log(`\x1b[36mVendor:\x1b[0m ${existing.name} (${existing.slug}) — exists`);
    if (apply) {
      await prisma.leadVendor.update({
        where: { id: existing.id },
        data: {
          name: VENDOR_NAME,
          active: true,
          routingTagField: 'routing_tag',
          fieldMapping: FIELD_MAPPING,
          webhookSecret: secret,
        },
      });
      console.log('  \x1b[32m✓\x1b[0m fieldMapping + secret updated');
    } else {
      console.log('  + would update fieldMapping + secret');
    }
    return { id: existing.id, secret };
  }

  if (!apply) {
    console.log(`  + would create vendor "${VENDOR_NAME}" (slug=${VENDOR_SLUG})`);
    return { id: null, secret };
  }

  const created = await prisma.leadVendor.create({
    data: {
      name: VENDOR_NAME,
      slug: VENDOR_SLUG,
      active: true,
      routingTagField: 'routing_tag',
      fieldMapping: FIELD_MAPPING,
      webhookSecret: secret,
    },
  });
  console.log(`  \x1b[32m✓\x1b[0m created vendor "${VENDOR_NAME}" (slug=${VENDOR_SLUG})`);
  return { id: created.id, secret };
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '\nAPPLY MODE — writes enabled\n' : '\nDRY RUN — no writes (pass --apply to commit)\n');

  const { secret } = await upsertVendor(apply);

  console.log('\n────────────────────────────────');
  console.log('Webhook URL:   /api/webhooks/leads/' + VENDOR_SLUG);
  console.log('Webhook secret (set as PORTAL_WEBHOOK_SECRET on the website):');
  console.log('  ' + secret);
  if (!apply) console.log('\nRe-run with --apply to commit.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
