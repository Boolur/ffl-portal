/**
 * Backfill missing leaderboard lead sources from the Lead Distribution database.
 *
 * Problem this solves:
 * Older disclosure / processing submissions may have no `submissionData.leadSource`
 * because Lead Source was not mandatory when they were submitted. The leaderboard
 * then groups those rows under "Unspecified lead source".
 *
 * This script finds those unknown task lead sources and cross-references the full
 * Lead Distribution `Lead` table by borrower name + property/mailing address. If
 * a matching Lead Distribution record exists, the task can safely be labeled as
 * `Lead Buy`.
 *
 * Usage (PowerShell):
 *   node src/scripts/backfillLeaderboardLeadSourcesFromLeads.mjs
 *   node src/scripts/backfillLeaderboardLeadSourcesFromLeads.mjs --apply
 *   node src/scripts/backfillLeaderboardLeadSourcesFromLeads.mjs --limit 50
 *   node src/scripts/backfillLeaderboardLeadSourcesFromLeads.mjs --include-plus-ones --apply
 *
 * Defaults:
 *   - Dry-run only. No writes unless --apply is present.
 *   - Checks SUBMIT_DISCLOSURES, SUBMIT_PROCESSING, and SUBMIT_QC tasks.
 *   - Does not overwrite known lead sources like "Referral", "Other", etc.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, TaskKind } from '@prisma/client';

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

const UNKNOWN_LEAD_SOURCE_VALUES = new Set([
  '',
  'n/a',
  'na',
  'none',
  'null',
  'unknown',
  'unknown lead source',
  'unspecified',
  'unspecified lead source',
]);

const STREET_SUFFIXES = new Map([
  ['avenue', 'ave'],
  ['boulevard', 'blvd'],
  ['circle', 'cir'],
  ['court', 'ct'],
  ['drive', 'dr'],
  ['highway', 'hwy'],
  ['lane', 'ln'],
  ['parkway', 'pkwy'],
  ['place', 'pl'],
  ['road', 'rd'],
  ['street', 'st'],
  ['terrace', 'ter'],
  ['trail', 'trl'],
  ['way', 'wy'],
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    apply: false,
    limit: 0,
    includePlusOnes: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--limit') opts.limit = Number(args[++i] || 0);
    else if (arg === '--include-plus-ones') opts.includePlusOnes = true;
  }

  return opts;
}

function asSubmissionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  const normalized = normalizeText(value).replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
  return normalized.length >= 3 ? normalized : '';
}

function normalizeAddress(value) {
  const normalized = normalizeText(value)
    .replace(/\b(apartment|apt|unit|suite|ste|space|spc|lot|#)\s+[a-z0-9-]+\b/g, '')
    .split(' ')
    .map((part) => STREET_SUFFIXES.get(part) || part)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\d/.test(normalized) && normalized.length >= 6 ? normalized : '';
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('@') ? normalized : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

function streetOnlyAddress(value) {
  const beforeComma = String(value || '').split(',')[0];
  return normalizeAddress(beforeComma);
}

function compactName(firstName, lastName) {
  return [firstName, lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
}

function borrowerNameFromTask(task) {
  const submission = asSubmissionObject(task.submissionData);
  const fromSubmission = compactName(submission.borrowerFirstName, submission.borrowerLastName);
  return fromSubmission || task.loan.borrowerName || '';
}

function addressCandidatesFromTask(task) {
  const submission = asSubmissionObject(task.submissionData);
  return [
    task.loan.propertyAddress,
    submission.subjectPropertyAddress,
    submission.propertyAddress,
    submission.address,
    submission.borrowerAddress,
  ].filter(Boolean);
}

function emailCandidatesFromTask(task) {
  const submission = asSubmissionObject(task.submissionData);
  return [
    submission.borrowerEmail,
    submission.email,
    task.loan.borrowerEmail,
  ].map(normalizeEmail).filter(Boolean);
}

function phoneCandidatesFromTask(task) {
  const submission = asSubmissionObject(task.submissionData);
  return [
    submission.borrowerPhone,
    submission.phone,
    task.loan.borrowerPhone,
  ].map(normalizePhone).filter(Boolean);
}

function addressCandidatesFromLead(lead) {
  const propertyFull = [
    lead.propertyAddress,
    lead.propertyCity,
    lead.propertyState,
    lead.propertyZip,
  ].filter(Boolean).join(', ');
  const mailingFull = [
    lead.mailingAddress,
    lead.mailingCity,
    lead.mailingState,
    lead.mailingZip,
  ].filter(Boolean).join(', ');

  return [
    propertyFull,
    lead.propertyAddress,
    mailingFull,
    lead.mailingAddress,
  ].filter(Boolean);
}

function emailCandidatesFromLead(lead) {
  return [
    lead.email,
  ].map(normalizeEmail).filter(Boolean);
}

function phoneCandidatesFromLead(lead) {
  return [
    lead.phone,
    lead.homePhone,
    lead.workPhone,
  ].map(normalizePhone).filter(Boolean);
}

function isUnknownLeadSource(value) {
  const normalized = normalizeText(value);
  return UNKNOWN_LEAD_SOURCE_VALUES.has(normalized);
}

function taskKindLabel(kind) {
  if (kind === TaskKind.SUBMIT_DISCLOSURES) return 'Disclosures';
  if (kind === TaskKind.SUBMIT_PROCESSING) return 'Processing';
  if (kind === TaskKind.SUBMIT_QC) return 'QC';
  if (kind === TaskKind.SUBMIT_PLUS_ONE) return '+1';
  return String(kind || 'Unknown');
}

function addLeadToIndex(index, key, lead) {
  if (!key) return;
  const existing = index.get(key) || [];
  existing.push(lead);
  index.set(key, existing);
}

function buildLeadIndexes(leads) {
  const fullAddressIndex = new Map();
  const streetAddressIndex = new Map();
  const emailIndex = new Map();
  const phoneIndex = new Map();

  for (const lead of leads) {
    const nameKey = normalizeName(compactName(lead.firstName, lead.lastName));
    if (!nameKey) continue;

    for (const address of addressCandidatesFromLead(lead)) {
      const fullAddress = normalizeAddress(address);
      const streetAddress = streetOnlyAddress(address);
      if (fullAddress) addLeadToIndex(fullAddressIndex, `${nameKey}|${fullAddress}`, lead);
      if (streetAddress) addLeadToIndex(streetAddressIndex, `${nameKey}|${streetAddress}`, lead);
    }
    for (const email of emailCandidatesFromLead(lead)) {
      addLeadToIndex(emailIndex, `${nameKey}|${email}`, lead);
    }
    for (const phone of phoneCandidatesFromLead(lead)) {
      addLeadToIndex(phoneIndex, `${nameKey}|${phone}`, lead);
    }
  }

  return { fullAddressIndex, streetAddressIndex, emailIndex, phoneIndex };
}

function findLeadMatch(task, indexes) {
  const nameKey = normalizeName(borrowerNameFromTask(task));
  if (!nameKey) return null;

  const addresses = addressCandidatesFromTask(task);
  for (const address of addresses) {
    const fullAddress = normalizeAddress(address);
    if (fullAddress) {
      const matches = indexes.fullAddressIndex.get(`${nameKey}|${fullAddress}`) || [];
      if (matches.length > 0) return { type: 'name+full-address', matches };
    }
  }

  for (const address of addresses) {
    const streetAddress = streetOnlyAddress(address);
    if (streetAddress) {
      const matches = indexes.streetAddressIndex.get(`${nameKey}|${streetAddress}`) || [];
      if (matches.length > 0) return { type: 'name+street-address', matches };
    }
  }

  for (const email of emailCandidatesFromTask(task)) {
    const matches = indexes.emailIndex.get(`${nameKey}|${email}`) || [];
    if (matches.length > 0) return { type: 'name+email', matches };
  }

  for (const phone of phoneCandidatesFromTask(task)) {
    const matches = indexes.phoneIndex.get(`${nameKey}|${phone}`) || [];
    if (matches.length > 0) return { type: 'name+phone', matches };
  }

  return null;
}

async function main() {
  const opts = parseArgs();
  const taskKinds = [
    TaskKind.SUBMIT_DISCLOSURES,
    TaskKind.SUBMIT_PROCESSING,
    TaskKind.SUBMIT_QC,
    ...(opts.includePlusOnes ? [TaskKind.SUBMIT_PLUS_ONE] : []),
  ];

  console.log(opts.apply ? '\nAPPLY MODE - writes enabled\n' : '\nDRY RUN - no writes (pass --apply to commit)\n');

  const [leads, tasks] = await Promise.all([
    prisma.lead.findMany({
      select: {
        id: true,
        vendorLeadId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        homePhone: true,
        workPhone: true,
        propertyAddress: true,
        propertyCity: true,
        propertyState: true,
        propertyZip: true,
        mailingAddress: true,
        mailingCity: true,
        mailingState: true,
        mailingZip: true,
        receivedAt: true,
        vendor: { select: { name: true, slug: true } },
        campaign: { select: { name: true, routingTag: true } },
      },
    }),
    prisma.task.findMany({
      where: { kind: { in: taskKinds } },
      select: {
        id: true,
        kind: true,
        status: true,
        createdAt: true,
        submissionData: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            propertyAddress: true,
            borrowerPhone: true,
            borrowerEmail: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(opts.limit > 0 ? { take: opts.limit } : {}),
    }),
  ]);

  const indexes = buildLeadIndexes(leads);
  const unknownTasks = [];
  const matched = [];
  const unmatched = [];
  const skippedKnown = [];

  for (const task of tasks) {
    const submission = asSubmissionObject(task.submissionData);
    if (!isUnknownLeadSource(submission.leadSource)) {
      skippedKnown.push(task);
      continue;
    }

    unknownTasks.push(task);
    const match = findLeadMatch(task, indexes);
    if (!match) {
      unmatched.push(task);
      continue;
    }

    const lead = match.matches[0];
    matched.push({ task, match, lead });
  }

  console.log(`Lead Distribution rows indexed: ${leads.length}`);
  console.log(`Submission tasks scanned:       ${tasks.length}`);
  console.log(`Known lead source skipped:      ${skippedKnown.length}`);
  console.log(`Unknown lead source tasks:      ${unknownTasks.length}`);
  console.log(`Matched to Lead Distribution:   ${matched.length}`);
  console.log(`Unmatched unknown tasks:        ${unmatched.length}`);

  const byKind = new Map();
  for (const entry of matched) {
    const label = taskKindLabel(entry.task.kind);
    byKind.set(label, (byKind.get(label) || 0) + 1);
  }
  if (byKind.size > 0) {
    console.log('\nMatched by kind:');
    for (const [kind, count] of [...byKind.entries()].sort()) {
      console.log(`  ${kind}: ${count}`);
    }
  }

  console.log('\nSample matches:');
  for (const entry of matched.slice(0, 20)) {
    console.log(
      `  ${taskKindLabel(entry.task.kind)} | ${entry.task.loan.loanNumber} | ${entry.task.loan.borrowerName} | ` +
      `${entry.match.type} | lead=${entry.lead.id} vendor=${entry.lead.vendor?.name || 'Unknown'}`
    );
  }

  if (!opts.apply) {
    console.log('\nDry run complete. Re-run with --apply to set matching unknown lead sources to "Lead Buy".');
    return;
  }

  let updated = 0;
  for (const entry of matched) {
    const submission = asSubmissionObject(entry.task.submissionData);
    const updatedSubmission = {
      ...submission,
      leadSource: 'Lead Buy',
      ...(submission.leadVendor ? {} : { leadVendor: entry.lead.vendor?.name || 'Lead Distribution' }),
      leadSourceBackfill: {
        source: 'Lead Distribution',
        script: 'backfillLeaderboardLeadSourcesFromLeads.mjs',
        matchedLeadId: entry.lead.id,
        matchedVendorLeadId: entry.lead.vendorLeadId || null,
        matchedVendorName: entry.lead.vendor?.name || null,
        matchType: entry.match.type,
        matchedAt: new Date().toISOString(),
      },
    };

    await prisma.task.update({
      where: { id: entry.task.id },
      data: { submissionData: updatedSubmission },
    });
    updated += 1;
  }

  console.log(`\nBackfill complete. Updated ${updated} task(s).`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
