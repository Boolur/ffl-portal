/**
 * Backfill missing Projected Revenue on Submit for Disclosures tasks from
 * same-loan Submit +1 or Submit for Processing task history.
 *
 * Usage:
 *   node src/scripts/backfillDisclosureProjectedRevenue.mjs
 *   node src/scripts/backfillDisclosureProjectedRevenue.mjs --apply
 *   node src/scripts/backfillDisclosureProjectedRevenue.mjs --limit 50
 *
 * Dry-run by default. A disclosure is updated only when another task on the
 * same Loan row has a positive Projected Revenue value.
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
  } catch (error) {
    console.warn(`[env] Could not read ${path}:`, error.message);
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { apply: false, limit: 0 };

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--apply') options.apply = true;
    else if (args[index] === '--limit') options.limit = Number(args[++index] || 0);
  }

  return options;
}

function asSubmissionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function parseMoneyNumber(value) {
  const parsed = Number(String(value ?? '').replace(/[$,\s]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function taskKindLabel(kind) {
  if (kind === TaskKind.SUBMIT_PLUS_ONE) return 'Submit +1';
  if (kind === TaskKind.SUBMIT_PROCESSING || kind === TaskKind.SUBMIT_QC) {
    return 'Submit for Processing';
  }
  return String(kind || 'Unknown');
}

function sourcePriority(kind) {
  return kind === TaskKind.SUBMIT_PLUS_ONE ? 0 : 1;
}

function selectClosestSource(disclosure, sources) {
  return [...sources].sort((left, right) => {
    const leftDistance = Math.abs(left.createdAt.getTime() - disclosure.createdAt.getTime());
    const rightDistance = Math.abs(right.createdAt.getTime() - disclosure.createdAt.getTime());
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;

    const priorityDifference = sourcePriority(left.kind) - sourcePriority(right.kind);
    if (priorityDifference !== 0) return priorityDifference;

    return left.createdAt.getTime() - right.createdAt.getTime();
  })[0];
}

async function main() {
  const options = parseArgs();
  console.log(
    options.apply
      ? '\nAPPLY MODE - disclosure Projected Revenue will be updated\n'
      : '\nDRY RUN - no writes\n'
  );

  const sourceKinds = [
    TaskKind.SUBMIT_PLUS_ONE,
    TaskKind.SUBMIT_PROCESSING,
    TaskKind.SUBMIT_QC,
  ];
  const [disclosures, sourceTasks] = await Promise.all([
    prisma.task.findMany({
      where: { kind: TaskKind.SUBMIT_DISCLOSURES },
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
    }),
    prisma.task.findMany({
      where: { kind: { in: sourceKinds } },
      select: {
        id: true,
        loanId: true,
        kind: true,
        createdAt: true,
        submissionData: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const validSourcesByLoan = new Map();
  for (const task of sourceTasks) {
    const submission = asSubmissionObject(task.submissionData);
    if (parseMoneyNumber(submission.projectedRevenue) <= 0) continue;
    const sources = validSourcesByLoan.get(task.loanId) || [];
    sources.push({
      ...task,
      projectedRevenue: String(submission.projectedRevenue).trim(),
    });
    validSourcesByLoan.set(task.loanId, sources);
  }

  const alreadyPopulated = [];
  const matched = [];
  const unmatched = [];

  for (const disclosure of disclosures) {
    const submission = asSubmissionObject(disclosure.submissionData);
    if (parseMoneyNumber(submission.projectedRevenue) > 0) {
      alreadyPopulated.push(disclosure);
      continue;
    }

    const sources = validSourcesByLoan.get(disclosure.loanId) || [];
    if (sources.length === 0) {
      unmatched.push(disclosure);
      continue;
    }

    const source = selectClosestSource(disclosure, sources);
    matched.push({ disclosure, source });
    if (options.limit > 0 && matched.length >= options.limit) break;
  }

  console.log(`Disclosure tasks scanned:       ${disclosures.length}`);
  console.log(`Already has Projected Revenue:  ${alreadyPopulated.length}`);
  console.log(`Valid same-loan source tasks:   ${sourceTasks.filter((task) => {
    const submission = asSubmissionObject(task.submissionData);
    return parseMoneyNumber(submission.projectedRevenue) > 0;
  }).length}`);
  console.log(`Matched disclosure requests:    ${matched.length}`);
  console.log(`No valid same-loan value found: ${unmatched.length}`);

  if (matched.length > 0) {
    console.log('\nSample matches:');
    for (const { disclosure, source } of matched.slice(0, 20)) {
      console.log(
        `  ${disclosure.loan.loanNumber} | ${disclosure.loan.borrowerName} | ` +
          `revenue=${source.projectedRevenue} | source=${taskKindLabel(source.kind)} ${source.id}`
      );
    }
  }

  if (!options.apply) {
    console.log(
      '\nDry run complete. Re-run with --apply to backfill matched disclosure requests.'
    );
    return;
  }

  let updated = 0;
  for (const { disclosure, source } of matched) {
    const submission = asSubmissionObject(disclosure.submissionData);
    await prisma.task.update({
      where: { id: disclosure.id },
      data: {
        submissionData: {
          ...submission,
          projectedRevenue: source.projectedRevenue,
          projectedRevenueBackfill: {
            sourceTaskId: source.id,
            sourceTaskKind: source.kind,
            sourceTaskCreatedAt: source.createdAt.toISOString(),
            script: 'backfillDisclosureProjectedRevenue.mjs',
            backfilledAt: new Date().toISOString(),
          },
        },
      },
    });
    updated += 1;
  }

  console.log(`\nBackfill complete. Updated ${updated} disclosure request(s).`);
}

main()
  .catch((error) => {
    console.error('Projected Revenue backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
