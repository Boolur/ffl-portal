// One-off script to bulk-create lead campaigns under an existing vendor.
//
// Edit CAMPAIGN_BATCHES below, then run:
//
//   node src/scripts/seedLeadCampaigns.mjs          # dry run (default)
//   node src/scripts/seedLeadCampaigns.mjs --apply  # actually insert
//
// - Vendor lookup is case-insensitive and matches on exact name.
// - Campaigns are upserted by the unique (vendorId, routingTag) pair, so
//   re-running the script is safe: existing rows are left untouched and
//   reported as "exists".
// - Members/default user are intentionally not set — assign users in the
//   admin UI after leads start flowing.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Each batch maps a vendor name to the campaigns that should exist
 * underneath it. Add additional batches here for other vendors when the
 * user sends more screenshots.
 */
const CAMPAIGN_BATCHES = [
  {
    vendorName: 'LendingTree',
    campaigns: [
      { name: '(FFL07) Refi | Cash Out | (600-699) Grade B', routingTag: '928790' },
      { name: '(FFL07) Refi | Cash Out | 100-250k LA | Grade A', routingTag: '928795' },
      { name: '(FFL07) Refi | Cash Out | 100-250k LA | Grade B', routingTag: '928794' },
      { name: '(FFL07) Refi | Cash Out | 700+ Grade B', routingTag: '928791' },
      { name: '(FFL07) VA C/O (600-699) Grade A', routingTag: '928787' },
      { name: '(FFL07) VA C/O (600-699) Grade B', routingTag: '928786' },
      { name: '(FFL07) VA C/O (700+) Grade A', routingTag: '928788' },
      { name: '(FFL07) VA C/O (700+) Grade B', routingTag: '928789' },
      { name: '(FFL07) HELO/CHELOANCredit(620-699)0-80LTVGradeB_DC', routingTag: '928779' },
      { name: '(FFL07) HELOC/HELOAN_Credit (700+) 0-80LTV(GRADE B)', routingTag: '928732' },
      { name: '(FFL07) HELOC/HELOANCredit(620-699) 0-80LTV(GradeA)', routingTag: '928781' },
      { name: '(FFL07) HELOC/HELOANCredit(700+)0-80 LTV(GradeB)_DC', routingTag: '928778' },
      { name: '(FFL07) HELOC/HELOANCredit(700+)0-80LTV(Grade A)', routingTag: '928782' },
      { name: '(FFL07) VA_HE (700+) Grade A', routingTag: '928784' },
      { name: '(FFL07) VA_HE (700+) Grade B', routingTag: '928785' },
      { name: '(FFL07) VA_HE Credit (600-699) Grade A', routingTag: '928783' },
      { name: '(FFL07) VA_HE Credit (600-699) Grade B', routingTag: '928733' },
    ],
  },
  {
    vendorName: 'FreeRateUpdate',
    campaigns: [
      { name: 'Cali Retail - FRU', routingTag: 'califru' },
      { name: 'FRU - Zoe Gannam', routingTag: 'zg-freerateupdate' },
      { name: 'FRU - Mikah Elgin', routingTag: 'me-freerateupdate' },
      { name: 'FRU - Ziad Ghossein', routingTag: 'zgh-freerateupdate' },
      { name: 'FRU - Ivan Velev', routingTag: 'iv-freerateupdate' },
      { name: 'FRU - Ghadi Dib', routingTag: 'gd-freerateupdate' },
      { name: 'FRU - Tyler Ferrier', routingTag: 'tf-freerateupdate' },
      { name: 'FRU - Tarek Ghossein', routingTag: 'tg-freerateupdate' },
      { name: 'FRU - Mo Daneshfar', routingTag: 'md-freerateupdate' },
      { name: 'FRU - Daniel Botero', routingTag: 'frudbotero' },
      { name: 'FRU - Chris Boulos', routingTag: 'frucboulos' },
      { name: 'FRU - Alfredo Arreola', routingTag: 'fruaarreola' },
      { name: 'FRU - Pavi Kaur', routingTag: 'frupkaur' },
      { name: 'FRU - Maral Mahjoub', routingTag: 'frumaralmahjoub' },
      { name: 'FRU - Peter Escaross', routingTag: 'frupescaross' },
      { name: 'FRU: Brooke Hancock', routingTag: 'frubhancock' },
      { name: 'FRU - Arya Ghafari', routingTag: 'ag-freerateupdate' },
      { name: 'FRU: Thomas Knebelsberger', routingTag: 'frutknebelsberger' },
      { name: 'FreeRateUpdate.com - Wolf', routingTag: 'fruwolf' },
      { name: 'FRU: Taylor Coulton', routingTag: 'frutaylorcoulton' },
      { name: 'FRU: Tarek Ghossein', routingTag: 'frutghossein' },
      { name: 'FRU: Peter Perez', routingTag: 'ppfru' },
      { name: 'FRU: Grant Passman', routingTag: 'frugpassman' },
      { name: 'FRU: Chase Maza', routingTag: 'cmfru' },
    ],
  },
  {
    vendorName: 'LeadPoint',
    campaigns: [
      { name: 'Lead Point - Tyler Ferrier', routingTag: 'lptferrier' },
      { name: 'Lead Point - Zoe Gannam', routingTag: 'lpzoegannam' },
      { name: 'Lead Point - Tarek Ghossein', routingTag: 'lptarekghossein' },
      { name: 'Lead Point - Mikah Elgin', routingTag: 'lpmikahelgin' },
      { name: 'LP - Pavi Kaur', routingTag: 'lppavikaur' },
      { name: 'Lead Point - Ghadi Dib', routingTag: 'lpgdib' },
      { name: 'Cali Retail - Leadpoint', routingTag: 'calileadpoint' },
      { name: 'LeadPoint Premium', routingTag: 'leadpointpremium' },
      { name: 'LP Team A Leads', routingTag: 'lpteama' },
      { name: 'LP Team B Leads', routingTag: 'lpteamb' },
      { name: 'Leadpoint; Coulton Refi', routingTag: 'lpcoultonrefi' },
      { name: 'LP:Denis Herrera', routingTag: 'lpdherrera' },
      { name: 'LP:Peter Perez', routingTag: 'lppeterperez' },
      { name: 'LP:Chase Maza', routingTag: 'lpchasemaza' },
      { name: 'LP:Tarek Ghossein', routingTag: 'lptarekghossein' },
    ],
  },
  {
    vendorName: 'Lendgo',
    campaigns: [
      { name: 'Lendgo', routingTag: 'lendgo' },
    ],
  },
];

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(apply ? '\nAPPLY MODE — writes enabled\n' : '\nDRY RUN — no writes (pass --apply to commit)\n');

  let totalToCreate = 0;
  let totalExisting = 0;
  let totalCreated = 0;

  for (const batch of CAMPAIGN_BATCHES) {
    const vendor = await prisma.leadVendor.findFirst({
      where: { name: { equals: batch.vendorName, mode: 'insensitive' } },
      select: { id: true, name: true, slug: true, active: true },
    });

    if (!vendor) {
      console.log(`\x1b[31m✗ Vendor not found: "${batch.vendorName}"\x1b[0m`);
      console.log('  Skipping this batch. Create the vendor first or edit the script.\n');
      continue;
    }

    console.log(`\x1b[36mVendor:\x1b[0m ${vendor.name} (${vendor.slug})${vendor.active ? '' : ' [archived]'}`);

    const existing = await prisma.leadCampaign.findMany({
      where: { vendorId: vendor.id },
      select: { routingTag: true, name: true },
    });
    const existingTags = new Set(existing.map((c) => c.routingTag));

    for (const c of batch.campaigns) {
      if (existingTags.has(c.routingTag)) {
        const match = existing.find((e) => e.routingTag === c.routingTag);
        console.log(`  \x1b[33m·\x1b[0m ${c.routingTag}  (exists) ${match?.name}`);
        totalExisting++;
        continue;
      }
      totalToCreate++;
      if (!apply) {
        console.log(`  \x1b[32m+\x1b[0m ${c.routingTag}  ${c.name}`);
        continue;
      }
      await prisma.leadCampaign.create({
        data: {
          name: c.name,
          description: null,
          vendorId: vendor.id,
          routingTag: c.routingTag,
          distributionMethod: 'ROUND_ROBIN',
          independentRotation: true,
          duplicateHandling: 'NONE',
          defaultLeadStatus: 'NEW',
          enableUserQuotas: true,
          defaultUserId: null,
          stateFilter: [],
          loanTypeFilter: [],
        },
      });
      totalCreated++;
      console.log(`  \x1b[32m✓\x1b[0m ${c.routingTag}  created — ${c.name}`);
    }
    console.log('');
  }

  console.log('────────────────────────────────');
  if (apply) {
    console.log(`Created: ${totalCreated}`);
    console.log(`Already existed: ${totalExisting}`);
  } else {
    console.log(`Would create: ${totalToCreate}`);
    console.log(`Already exists (skipped): ${totalExisting}`);
    console.log('\nRe-run with --apply to commit.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
