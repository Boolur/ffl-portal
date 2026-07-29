/**
 * Backfill Lead.status from matched Pipeline / Leaderboard submissions.
 *
 * Usage:
 *   node src/scripts/backfillLeadStatusesFromPipelineMatches.mjs
 *   node src/scripts/backfillLeadStatusesFromPipelineMatches.mjs --apply
 *
 * Defaults to dry-run. A lead is only updated when a submitted task matches a
 * single Lead row by borrower name plus email, phone, or address. If multiple
 * submitted milestones match the same lead, the most advanced milestone wins:
 * Processing/QC > Disclosures > +1.
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

const STATUS_RANK = {
  NEW: 0,
  HOT: 1,
  COLD: 1,
  DNQ: 1,
  UNASSIGNED: 0,
  SUBMITTED_PLUS_ONE: 2,
  SUBMITTED_DISCLOSURES: 3,
  SUBMITTED_PROCESSING: 4,
};

const MILESTONE_STATUS = {
  [TaskKind.SUBMIT_PLUS_ONE]: 'SUBMITTED_PLUS_ONE',
  [TaskKind.SUBMIT_DISCLOSURES]: 'SUBMITTED_DISCLOSURES',
  [TaskKind.SUBMIT_PROCESSING]: 'SUBMITTED_PROCESSING',
  [TaskKind.SUBMIT_QC]: 'SUBMITTED_PROCESSING',
};

function parseArgs() {
  return {
    apply: process.argv.includes('--apply'),
    limit: Number(process.argv[process.argv.indexOf('--limit') + 1] || 0),
  };
}

function submissionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
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
  return normalizeText(value)
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('@') ? normalized : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
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

function streetOnlyAddress(value) {
  return normalizeAddress(String(value || '').split(',')[0]);
}

function compactName(firstName, lastName) {
  return [firstName, lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addIndexValue(index, key, lead) {
  if (!key) return;
  const rows = index.get(key) || [];
  rows.push(lead);
  index.set(key, rows);
}

function leadNames(lead) {
  return unique([
    normalizeName(compactName(lead.firstName, lead.lastName)),
    normalizeName(compactName(lead.coFirstName, lead.coLastName)),
  ]);
}

function leadEmails(lead) {
  return unique([lead.email, lead.coEmail].map(normalizeEmail));
}

function leadPhones(lead) {
  return unique([
    lead.phone,
    lead.homePhone,
    lead.workPhone,
    lead.coPhone,
    lead.coHomePhone,
    lead.coWorkPhone,
  ].map(normalizePhone));
}

function leadAddresses(lead) {
  return unique([
    [lead.propertyAddress, lead.propertyCity, lead.propertyState, lead.propertyZip].filter(Boolean).join(', '),
    lead.propertyAddress,
    [lead.mailingAddress, lead.mailingCity, lead.mailingState, lead.mailingZip].filter(Boolean).join(', '),
    lead.mailingAddress,
  ]);
}

function buildLeadIndexes(leads) {
  const indexes = {
    fullAddress: new Map(),
    streetAddress: new Map(),
    email: new Map(),
    phone: new Map(),
  };

  for (const lead of leads) {
    for (const name of leadNames(lead)) {
      for (const email of leadEmails(lead)) {
        addIndexValue(indexes.email, `${name}|${email}`, lead);
      }
      for (const phone of leadPhones(lead)) {
        addIndexValue(indexes.phone, `${name}|${phone}`, lead);
      }
      for (const address of leadAddresses(lead)) {
        const fullAddress = normalizeAddress(address);
        const streetAddress = streetOnlyAddress(address);
        if (fullAddress) addIndexValue(indexes.fullAddress, `${name}|${fullAddress}`, lead);
        if (streetAddress) addIndexValue(indexes.streetAddress, `${name}|${streetAddress}`, lead);
      }
    }
  }

  return indexes;
}

function taskNameCandidates(task) {
  const submission = submissionObject(task.submissionData);
  return unique([
    normalizeName(compactName(submission.borrowerFirstName, submission.borrowerLastName)),
    normalizeName(task.loan.borrowerName),
  ]);
}

function taskEmailCandidates(task) {
  const submission = submissionObject(task.submissionData);
  return unique([
    submission.borrowerEmail,
    submission.email,
    task.loan.borrowerEmail,
  ].map(normalizeEmail));
}

function taskPhoneCandidates(task) {
  const submission = submissionObject(task.submissionData);
  return unique([
    submission.borrowerPhone,
    submission.phone,
    task.loan.borrowerPhone,
  ].map(normalizePhone));
}

function taskAddressCandidates(task) {
  const submission = submissionObject(task.submissionData);
  return unique([
    task.loan.propertyAddress,
    submission.subjectPropertyAddress,
    submission.propertyAddress,
    submission.address,
    submission.borrowerAddress,
  ]);
}

function findUniqueLeadMatch(task, indexes) {
  const names = taskNameCandidates(task);
  const addresses = taskAddressCandidates(task);

  for (const name of names) {
    for (const address of addresses) {
      const matches = indexes.fullAddress.get(`${name}|${normalizeAddress(address)}`) || [];
      if (matches.length === 1) return { lead: matches[0], matchType: 'name+full-address' };
      if (matches.length > 1) return { lead: null, matchType: 'ambiguous-name+full-address' };
    }
  }

  for (const name of names) {
    for (const address of addresses) {
      const matches = indexes.streetAddress.get(`${name}|${streetOnlyAddress(address)}`) || [];
      if (matches.length === 1) return { lead: matches[0], matchType: 'name+street-address' };
      if (matches.length > 1) return { lead: null, matchType: 'ambiguous-name+street-address' };
    }
  }

  for (const name of names) {
    for (const email of taskEmailCandidates(task)) {
      const matches = indexes.email.get(`${name}|${email}`) || [];
      if (matches.length === 1) return { lead: matches[0], matchType: 'name+email' };
      if (matches.length > 1) return { lead: null, matchType: 'ambiguous-name+email' };
    }
  }

  for (const name of names) {
    for (const phone of taskPhoneCandidates(task)) {
      const matches = indexes.phone.get(`${name}|${phone}`) || [];
      if (matches.length === 1) return { lead: matches[0], matchType: 'name+phone' };
      if (matches.length > 1) return { lead: null, matchType: 'ambiguous-name+phone' };
    }
  }

  return { lead: null, matchType: 'none' };
}

function shouldReplaceStatus(currentStatus, nextStatus) {
  return (STATUS_RANK[nextStatus] || 0) > (STATUS_RANK[currentStatus] || 0);
}

function taskKindLabel(kind) {
  if (kind === TaskKind.SUBMIT_PLUS_ONE) return '+1';
  if (kind === TaskKind.SUBMIT_DISCLOSURES) return 'Disclosures';
  if (kind === TaskKind.SUBMIT_PROCESSING) return 'Processing';
  if (kind === TaskKind.SUBMIT_QC) return 'QC';
  return String(kind || 'Unknown');
}

async function main() {
  const opts = parseArgs();
  const taskKinds = Object.keys(MILESTONE_STATUS);

  console.log(opts.apply ? '\nAPPLY MODE - writes enabled\n' : '\nDRY RUN - no writes (pass --apply to commit)\n');

  const [leads, tasks] = await Promise.all([
    prisma.lead.findMany({
      select: {
        id: true,
        status: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        homePhone: true,
        workPhone: true,
        coFirstName: true,
        coLastName: true,
        coEmail: true,
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
      },
    }),
    prisma.task.findMany({
      where: { kind: { in: taskKinds } },
      select: {
        id: true,
        kind: true,
        createdAt: true,
        submissionData: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            borrowerEmail: true,
            borrowerPhone: true,
            propertyAddress: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(opts.limit > 0 ? { take: opts.limit } : {}),
    }),
  ]);

  const indexes = buildLeadIndexes(leads);
  const updatesByLeadId = new Map();
  const stats = {
    leadsIndexed: leads.length,
    tasksScanned: tasks.length,
    uniqueMatches: 0,
    ambiguous: 0,
    unmatched: 0,
    skippedNoUpgrade: 0,
    byMatchType: new Map(),
    byStatus: new Map(),
  };

  for (const task of tasks) {
    const nextStatus = MILESTONE_STATUS[task.kind];
    const match = findUniqueLeadMatch(task, indexes);
    if (!match.lead) {
      if (match.matchType.startsWith('ambiguous')) stats.ambiguous += 1;
      else stats.unmatched += 1;
      continue;
    }

    stats.uniqueMatches += 1;
    stats.byMatchType.set(match.matchType, (stats.byMatchType.get(match.matchType) || 0) + 1);

    const existingUpdate = updatesByLeadId.get(match.lead.id);
    const currentComparableStatus = existingUpdate?.nextStatus || match.lead.status;
    if (!shouldReplaceStatus(currentComparableStatus, nextStatus)) {
      stats.skippedNoUpgrade += 1;
      continue;
    }

    updatesByLeadId.set(match.lead.id, {
      lead: match.lead,
      nextStatus,
      task,
      matchType: match.matchType,
    });
  }

  for (const update of updatesByLeadId.values()) {
    stats.byStatus.set(update.nextStatus, (stats.byStatus.get(update.nextStatus) || 0) + 1);
  }

  console.log(`Lead rows indexed:          ${stats.leadsIndexed}`);
  console.log(`Submitted tasks scanned:    ${stats.tasksScanned}`);
  console.log(`Unique task matches:        ${stats.uniqueMatches}`);
  console.log(`Ambiguous task matches:     ${stats.ambiguous}`);
  console.log(`Unmatched tasks:            ${stats.unmatched}`);
  console.log(`Skipped lower/no upgrades:  ${stats.skippedNoUpgrade}`);
  console.log(`Lead rows to update:        ${updatesByLeadId.size}`);

  if (stats.byMatchType.size > 0) {
    console.log('\nMatches by type:');
    for (const [type, count] of [...stats.byMatchType.entries()].sort()) {
      console.log(`  ${type}: ${count}`);
    }
  }

  if (stats.byStatus.size > 0) {
    console.log('\nLead updates by new status:');
    for (const [status, count] of [...stats.byStatus.entries()].sort()) {
      console.log(`  ${status}: ${count}`);
    }
  }

  console.log('\nSample updates:');
  for (const update of [...updatesByLeadId.values()].slice(0, 20)) {
    console.log(
      `  ${update.lead.status} -> ${update.nextStatus} | ` +
      `${taskKindLabel(update.task.kind)} | loan=${update.task.loan.loanNumber} | ` +
      `${update.task.loan.borrowerName} | ${update.matchType} | lead=${update.lead.id}`
    );
  }

  if (!opts.apply) {
    console.log('\nDry run complete. Re-run with --apply to update matched lead statuses.');
    return;
  }

  let updated = 0;
  for (const update of updatesByLeadId.values()) {
    await prisma.lead.update({
      where: { id: update.lead.id },
      data: { status: update.nextStatus },
    });
    updated += 1;
  }

  console.log(`\nBackfill complete. Updated ${updated} lead(s).`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
