/**
 * Remove duplicate Submit +1 task rows by normalized Arive loan number.
 *
 * Usage:
 *   node src/scripts/dedupePlusOneSubmissionsByArive.mjs
 *   node src/scripts/dedupePlusOneSubmissionsByArive.mjs --apply
 *
 * Dry-run by default. In apply mode, keeps the earliest +1 task for each Arive
 * number and deletes later duplicate +1 task rows. Related task attachments are
 * cascaded by the database; notifications keep history with taskId set null.
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

function parseArgs() {
  return {
    apply: process.argv.includes('--apply'),
  };
}

function asSubmissionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function normalizeAriveNumber(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function loanNumberFromTask(task) {
  const submission = asSubmissionObject(task.submissionData);
  return (
    submission.arriveLoanNumber ||
    submission.ariveLoanNumber ||
    submission.loanNumber ||
    task.loan?.loanNumber ||
    ''
  );
}

async function main() {
  const opts = parseArgs();
  console.log(opts.apply ? '\nAPPLY MODE - duplicate +1 tasks will be deleted\n' : '\nDRY RUN - no writes\n');

  const tasks = await prisma.task.findMany({
    where: { kind: TaskKind.SUBMIT_PLUS_ONE },
    select: {
      id: true,
      loanId: true,
      createdAt: true,
      submissionData: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const groups = new Map();
  const missingLoanNumber = [];
  for (const task of tasks) {
    const key = normalizeAriveNumber(loanNumberFromTask(task));
    if (!key) {
      missingLoanNumber.push(task);
      continue;
    }
    const group = groups.get(key) || [];
    group.push(task);
    groups.set(key, group);
  }

  const duplicateGroups = [...groups.entries()]
    .map(([ariveNumber, group]) => ({
      ariveNumber,
      keep: group[0],
      duplicates: group.slice(1),
    }))
    .filter((group) => group.duplicates.length > 0);
  const duplicateTaskIds = duplicateGroups.flatMap((group) => group.duplicates.map((task) => task.id));

  console.log(`+1 tasks scanned:             ${tasks.length}`);
  console.log(`Unique Arive numbers:         ${groups.size}`);
  console.log(`Tasks missing Arive number:   ${missingLoanNumber.length}`);
  console.log(`Duplicate Arive groups:       ${duplicateGroups.length}`);
  console.log(`Duplicate +1 tasks to delete: ${duplicateTaskIds.length}`);

  if (duplicateGroups.length > 0) {
    console.log('\nSample duplicate groups:');
    for (const group of duplicateGroups.slice(0, 20)) {
      console.log(
        `  ${group.ariveNumber} | keep=${group.keep.id} (${group.keep.createdAt.toISOString()}) ` +
        `borrower=${group.keep.loan?.borrowerName || 'N/A'} | delete=${group.duplicates.length}`
      );
      for (const duplicate of group.duplicates.slice(0, 5)) {
        console.log(`    delete ${duplicate.id} (${duplicate.createdAt.toISOString()}) loanId=${duplicate.loanId}`);
      }
    }
  }

  if (!opts.apply) {
    console.log('\nDry run complete. Re-run with --apply to delete duplicate +1 task rows.');
    return;
  }

  if (duplicateTaskIds.length === 0) {
    console.log('\nNo duplicate +1 task rows to delete.');
    return;
  }

  const result = await prisma.task.deleteMany({
    where: { id: { in: duplicateTaskIds } },
  });

  console.log(`\nDeleted ${result.count} duplicate +1 task row(s).`);
}

main()
  .catch((error) => {
    console.error('Duplicate +1 cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
