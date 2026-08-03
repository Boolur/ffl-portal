// Imports the legacy BISU website officer seeds into portal-owned draft profiles.
//
//   node src/scripts/migrateWebsiteOfficerProfiles.mjs
//   node src/scripts/migrateWebsiteOfficerProfiles.mjs --apply
//
// The default source is the sibling "BISU Home Loans Portal" repository. Set
// BISU_OFFICERS_SOURCE when the repositories are checked out elsewhere.

import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();
const DEFAULT_STATES = [
  'AL', 'AZ', 'CA', 'CO', 'FL', 'GA', 'ID', 'IA', 'LA', 'MD', 'MI', 'MN',
  'NV', 'NC', 'OH', 'OK', 'OR', 'PA', 'TN', 'TX', 'UT', 'WA',
];
const DEFAULT_SPECIALTIES = ['Purchase', 'Refinance', 'Home Equity'];
const DEFAULT_PHONE = '(855) 517-3388';

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Could not parse section beginning with ${start}`);
  }
  return source.slice(startIndex, endIndex);
}

function parseQuotedMap(block) {
  return new Map(
    Array.from(block.matchAll(/"([^"]+)"\s*:\s*"([^"]+)"/g), (match) => [
      match[1],
      match[2],
    ]),
  );
}

function parseQuotedSet(block) {
  return new Set(Array.from(block.matchAll(/"([^"]+)"/g), (match) => match[1]));
}

function parseSeeds(block) {
  return Array.from(
    block.matchAll(
      /\{\s*name:\s*"([^"]+)",\s*email:\s*"([^"]+)"(?:,\s*nmls:\s*"([^"]+)")?\s*\}/g,
    ),
    (match) => ({ name: match[1], email: match[2].toLowerCase(), nmls: match[3] ?? null }),
  );
}

async function main() {
  const apply = process.argv.includes('--apply');
  const sourcePath =
    process.env.BISU_OFFICERS_SOURCE ||
    path.resolve(process.cwd(), '..', 'BISU Home Loans Portal', 'src', 'content', 'officers.ts');
  const source = await readFile(sourcePath, 'utf8');

  const photos = parseQuotedMap(
    section(source, 'const OFFICER_PHOTOS', 'const LEADERSHIP_TITLES'),
  );
  const titles = parseQuotedMap(
    section(source, 'const LEADERSHIP_TITLES', 'const SUPPORT_ROLE_SLUGS'),
  );
  const supportSlugs = parseQuotedSet(
    section(source, 'const SUPPORT_ROLE_SLUGS', 'type OfficerSeed'),
  );
  const seeds = parseSeeds(section(source, 'const OFFICER_SEEDS', 'function slugify'));
  if (seeds.length === 0) throw new Error('No officer seeds were parsed.');

  console.log(apply ? 'APPLY MODE — importing drafts' : 'DRY RUN — no writes');
  console.log(`Source: ${sourcePath}`);

  let matched = 0;
  let unmatched = 0;
  let skippedRole = 0;

  for (const seed of seeds) {
    const user = await prisma.user.findUnique({
      where: { email: seed.email },
      select: { id: true, name: true, role: true, roles: true },
    });
    if (!user) {
      unmatched += 1;
      console.log(`UNMATCHED  ${seed.email} (${seed.name})`);
      continue;
    }
    if (user.role !== 'LOAN_OFFICER' && !user.roles.includes('LOAN_OFFICER')) {
      skippedRole += 1;
      console.log(`NOT LO     ${seed.email} (${user.name})`);
      continue;
    }

    const slug = slugify(seed.name);
    const isSupport = supportSlugs.has(slug);
    const title =
      titles.get(slug) ||
      (isSupport || !seed.nmls ? 'Loan Officer Assistant' : 'Mortgage Loan Originator');
    const bio =
      title === 'Loan Officer Assistant'
        ? `${seed.name} supports the BISU Home Loans lending team with responsive client care, document coordination, and a smoother path from first conversation to clear next steps.`
        : `${seed.name} is a ${title} with BISU Home Loans, helping clients compare purchase, refinance, and home equity options with clear guidance, fast communication, and a people-first lending experience.`;

    matched += 1;
    console.log(`MATCHED    ${seed.email} -> ${slug}`);
    if (!apply) continue;

    await prisma.websiteLoanOfficerProfile.upsert({
      where: { userId: user.id },
      update: {
        slug,
        title,
        nmls: seed.nmls,
        photoUrl: photos.get(slug) ?? null,
        phone: DEFAULT_PHONE,
        licensedStates: DEFAULT_STATES,
        specialties: isSupport ? ['Client Support', 'Loan Coordination'] : DEFAULT_SPECIALTIES,
        languages: ['English'],
        bio,
      },
      create: {
        userId: user.id,
        slug,
        title,
        nmls: seed.nmls,
        photoUrl: photos.get(slug) ?? null,
        phone: DEFAULT_PHONE,
        licensedStates: DEFAULT_STATES,
        specialties: isSupport ? ['Client Support', 'Loan Coordination'] : DEFAULT_SPECIALTIES,
        languages: ['English'],
        bio,
      },
    });
  }

  console.log(`\nMatched: ${matched}; unmatched: ${unmatched}; non-LO: ${skippedRole}`);
  if (!apply) console.log('Re-run with --apply after reviewing the report.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
