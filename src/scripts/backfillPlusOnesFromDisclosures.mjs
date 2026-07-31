/**
 * Backfill missing Submit +1 tasks from historical Submit for Disclosures tasks.
 *
 * Usage:
 *   node src/scripts/backfillPlusOnesFromDisclosures.mjs
 *   node src/scripts/backfillPlusOnesFromDisclosures.mjs --apply
 *   node src/scripts/backfillPlusOnesFromDisclosures.mjs --limit 50
 *
 * Dry-run by default. In apply mode, creates one completed SUBMIT_PLUS_ONE task
 * per loan that has a SUBMIT_DISCLOSURES task and no existing +1 task.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, TaskKind, TaskPriority, TaskStatus } from '@prisma/client';

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
  const args = process.argv.slice(2);
  const opts = {
    apply: false,
    limit: 0,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--limit') opts.limit = Number(args[++i] || 0);
  }

  return opts;
}

function asSubmissionObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function resolveLenderDisplayName(value) {
  const raw = String(value ?? '').trim();
  return raw || '';
}

function compactName(firstName, lastName) {
  return [firstName, lastName]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function splitBorrowerName(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function buildPlusOneSubmissionData(disclosureTask) {
  const disclosureData = asSubmissionObject(disclosureTask.submissionData);
  const fallbackName = splitBorrowerName(disclosureTask.loan.borrowerName);
  const borrowerFirstName = String(disclosureData.borrowerFirstName ?? fallbackName.firstName).trim();
  const borrowerLastName = String(disclosureData.borrowerLastName ?? fallbackName.lastName).trim();
  const loanOfficerName = disclosureTask.loan.loanOfficer?.name || String(disclosureData.loanOfficer ?? 'Loan Officer');
  const secondaryLoanOfficerName =
    disclosureTask.loan.secondaryLoanOfficer?.name ||
    String(disclosureData.secondaryLoanOfficerName ?? 'N/A');

  return {
    ...disclosureData,
    workflowVersion: 'plus-one-v1',
    autoCreatedFrom: 'submit-disclosures-backfill',
    autoCreatedFromTaskId: disclosureTask.id,
    autoBackfilledAt: new Date().toISOString(),
    submittedAt: disclosureTask.createdAt.toISOString(),
    submittedById: String(disclosureData.submittedById ?? ''),
    submittedByName: String(disclosureData.submittedByName ?? loanOfficerName),
    loanOfficer: loanOfficerName,
    loanOfficerId: disclosureTask.loan.loanOfficerId,
    secondaryLoanOfficerId: disclosureTask.loan.secondaryLoanOfficerId,
    secondaryLoanOfficerName,
    arriveLoanNumber: disclosureTask.loan.loanNumber,
    borrowerFirstName,
    borrowerLastName,
    borrowerPhone: String(disclosureData.borrowerPhone ?? disclosureTask.loan.borrowerPhone ?? ''),
    borrowerEmail: String(disclosureData.borrowerEmail ?? disclosureTask.loan.borrowerEmail ?? ''),
    lender: resolveLenderDisplayName(disclosureData.lender ?? disclosureData.investor),
    loanAmount: String(disclosureData.loanAmount ?? disclosureTask.loan.amount ?? ''),
    nextMilestone: String(disclosureData.nextMilestone ?? 'Submitting to disclosures'),
    notes: String(disclosureData.notes ?? disclosureTask.description ?? ''),
  };
}

async function main() {
  const opts = parseArgs();
  console.log(opts.apply ? '\nAPPLY MODE - missing +1 tasks will be created\n' : '\nDRY RUN - no writes\n');

  const [existingPlusOnes, disclosureTasks] = await Promise.all([
    prisma.task.findMany({
      where: { kind: TaskKind.SUBMIT_PLUS_ONE },
      select: { loanId: true },
    }),
    prisma.task.findMany({
      where: { kind: TaskKind.SUBMIT_DISCLOSURES },
      select: {
        id: true,
        loanId: true,
        description: true,
        createdAt: true,
        submissionData: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            borrowerName: true,
            borrowerPhone: true,
            borrowerEmail: true,
            amount: true,
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            loanOfficer: { select: { name: true } },
            secondaryLoanOfficer: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const loansWithPlusOne = new Set(existingPlusOnes.map((task) => task.loanId));
  const candidates = [];

  for (const task of disclosureTasks) {
    if (loansWithPlusOne.has(task.loanId)) continue;
    candidates.push(task);
    loansWithPlusOne.add(task.loanId);
    if (opts.limit > 0 && candidates.length >= opts.limit) break;
  }

  console.log(`Disclosure tasks scanned: ${disclosureTasks.length}`);
  console.log(`Loans already with +1:    ${existingPlusOnes.length}`);
  console.log(`Missing +1 candidates:    ${candidates.length}`);

  if (candidates.length > 0) {
    console.log('\nSample candidates:');
    for (const task of candidates.slice(0, 20)) {
      const data = buildPlusOneSubmissionData(task);
      const borrowerName = compactName(data.borrowerFirstName, data.borrowerLastName) || task.loan.borrowerName;
      console.log(
        `  ${task.loan.loanNumber} | ${borrowerName} | disclosure=${task.id} | created=${task.createdAt.toISOString()}`
      );
    }
  }

  if (!opts.apply) {
    console.log('\nDry run complete. Re-run with --apply to create missing +1 task rows.');
    return;
  }

  let created = 0;
  for (const task of candidates) {
    await prisma.task.create({
      data: {
        loanId: task.loanId,
        title: 'Submit +1',
        kind: TaskKind.SUBMIT_PLUS_ONE,
        description: task.description || null,
        submissionData: buildPlusOneSubmissionData(task),
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.NORMAL,
        completedAt: task.createdAt,
        createdAt: task.createdAt,
      },
    });
    created += 1;
  }

  console.log(`\nBackfill complete. Created ${created} Submit +1 task(s).`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
