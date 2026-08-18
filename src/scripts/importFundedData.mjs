/**
 * Idempotent funded-data backfill.
 *
 * Usage:
 *   node src/scripts/importFundedData.mjs "C:\path\Funded Data.xlsx"
 *   node src/scripts/importFundedData.mjs "C:\path\Funded Data.xlsx" --apply
 *
 * Dry-run is the default. Apply mode requires the funded-import Prisma migration.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  PayrollCompRequestStatus,
  PayrollLoanChannel,
  PayrollProcessingType,
  PrismaClient,
  ProcessingItemStatus,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  TaskKind,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import {
  FUNDED_IMPORT_SOURCE,
  addMonthsClampedUtc,
  getMortgageFirstPaymentDateUtc,
  normalizeAriveNumber,
  parseFundedWorkbook,
  payrollLeadProvidedByFor,
  payrollLeadSourceFor,
} from '../lib/fundedDataImport.mjs';

function loadDotEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // The Prisma client will surface a clear error if DATABASE_URL is unavailable.
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));

const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const workbookPath = args.find((arg) => !arg.startsWith('--'));
  if (!workbookPath) {
    throw new Error('Workbook path is required.');
  }
  const reportArg = args.indexOf('--report');
  return {
    workbookPath: resolve(workbookPath),
    apply: args.includes('--apply'),
    reportPath:
      reportArg >= 0 && args[reportArg + 1]
        ? resolve(args[reportArg + 1])
        : join(dirname(resolve(workbookPath)), `${basename(workbookPath, '.xlsx')}.import-report.json`),
  };
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {};
}

function loanNumberFromSubmission(value) {
  const data = asObject(value);
  return (
    data.arriveLoanNumber ??
    data.ariveLoanNumber ??
    data.arriveNumber ??
    data.ariveNumber ??
    data.loanNumber ??
    null
  );
}

function splitBorrowerName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
  };
}

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function dateOnly(value) {
  return value ? new Date(value).toISOString().slice(0, 10) : null;
}

function serialize(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      return item;
    }),
  );
}

function pipelineLockedDefaults(lender, fundedAt) {
  const normalized = String(lender || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  if (!['AVEN', 'FIGURE', 'NFTY'].some((name) => normalized === name || normalized.startsWith(`${name} `))) {
    return {};
  }
  return {
    titleStatus: ProcessingItemStatus.RECEIVED,
    payoffStatus: ProcessingItemStatus.RECEIVED,
    payoffOrderedAt: null,
    hoiStatus: ProcessingItemStatus.RECEIVED,
    hoiOrderedAt: null,
    appraisalNeeded: false,
    cdSent: true,
    cdWarningStartsAt: null,
    rateLock: true,
    rateLockExpiresAt: null,
    rateLockConfirmedAt: fundedAt,
    rateLockRequestedAt: null,
    rateLockRequestedById: null,
  };
}

function payrollProcessingType(pipelineMethod) {
  const value = String(pipelineMethod || '').trim().toUpperCase();
  if (value === 'IN_HOUSE') return PayrollProcessingType.IN_HOUSE;
  if (value === 'THIRD_PARTY') return PayrollProcessingType.CONTRACT;
  return PayrollProcessingType.OTHER;
}

async function resolveActor() {
  const actors = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: { in: [UserRole.ADMIN_III, UserRole.ADMIN_II] } },
        { roles: { hasSome: [UserRole.ADMIN_III, UserRole.ADMIN_II] } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1,
  });
  if (!actors[0]) throw new Error('No active Admin II/III user is available for import auditing.');
  return actors[0];
}

async function loadPortalIndexes(rows) {
  const [users, loans, tasks, pipelines, payrollRequests] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, roles: true },
    }),
    prisma.loan.findMany({
      select: {
        id: true,
        loanNumber: true,
        borrowerName: true,
        amount: true,
        program: true,
        loanOfficerId: true,
        secondaryLoanOfficerId: true,
      },
    }),
    prisma.task.findMany({
      where: {
        kind: {
          in: [
            TaskKind.SUBMIT_PLUS_ONE,
            TaskKind.SUBMIT_DISCLOSURES,
            TaskKind.SUBMIT_PROCESSING,
            TaskKind.SUBMIT_QC,
          ],
        },
      },
      select: { id: true, loanId: true, kind: true, createdAt: true, submissionData: true },
    }),
    prisma.processingPipelineLoan.findMany({
      select: {
        id: true,
        loanId: true,
        sourceTaskId: true,
        processingMethod: true,
        sheet: true,
        pipelineStatus: true,
        lender: true,
        loanType: true,
        propertyState: true,
        dateAssigned: true,
        fundedAt: true,
        finalRevenue: true,
      },
    }),
    prisma.payrollCompRequest.findMany({
      select: {
        id: true,
        loanId: true,
        loanOfficerId: true,
        loanNumber: true,
        borrowerName: true,
        lender: true,
        leadSource: true,
        leadSourceDetail: true,
        expectedRevenue: true,
        status: true,
        submittedAt: true,
        paidAt: true,
        submitterNotes: true,
      },
    }),
  ]);

  const usersByName = new Map();
  for (const user of users) {
    const key = user.name.trim().toLowerCase();
    const existing = usersByName.get(key) || [];
    existing.push(user);
    usersByName.set(key, existing);
  }

  const loansById = new Map(loans.map((loan) => [loan.id, loan]));
  const loanIdsByKey = new Map();
  const addLoanKey = (rawKey, loanId) => {
    const key = normalizeAriveNumber(rawKey);
    if (!key) return;
    const ids = loanIdsByKey.get(key) || new Set();
    ids.add(loanId);
    loanIdsByKey.set(key, ids);
  };
  for (const loan of loans) addLoanKey(loan.loanNumber, loan.id);
  for (const task of tasks) addLoanKey(loanNumberFromSubmission(task.submissionData), task.loanId);

  const payrollByKey = new Map();
  for (const request of payrollRequests) {
    const key = normalizeAriveNumber(request.loanNumber);
    if (!key) continue;
    const existing = payrollByKey.get(key) || [];
    existing.push(request);
    payrollByKey.set(key, existing);
  }

  const tasksByLoanId = new Map();
  for (const task of tasks) {
    const existing = tasksByLoanId.get(task.loanId) || [];
    existing.push(task);
    tasksByLoanId.set(task.loanId, existing);
  }

  const pipelineByLoanId = new Map(pipelines.map((pipeline) => [pipeline.loanId, pipeline]));
  const rowKeys = new Set(rows.map((row) => row.ariveNumber));
  return {
    usersByName,
    loansById,
    loanIdsByKey,
    payrollByKey,
    tasksByLoanId,
    pipelineByLoanId,
    rowKeys,
  };
}

function resolveRows(rows, indexes) {
  const resolved = [];
  const blocked = [];
  for (const row of rows) {
    const userMatches = indexes.usersByName.get(row.loanOfficer.trim().toLowerCase()) || [];
    const loanIds = [...(indexes.loanIdsByKey.get(row.ariveNumber) || [])];
    const payrollMatches = indexes.payrollByKey.get(row.ariveNumber) || [];
    const reasons = [];
    if (userMatches.length !== 1) {
      reasons.push(
        userMatches.length === 0
          ? `No active user named ${row.loanOfficer}`
          : `Multiple active users named ${row.loanOfficer}`,
      );
    }
    if (loanIds.length > 1) reasons.push('ARIVE matches multiple portal loans');
    if (payrollMatches.length > 1) reasons.push('ARIVE matches multiple payroll requests');
    if (reasons.length > 0) {
      blocked.push({ row, reasons });
      continue;
    }
    const loan = loanIds[0] ? indexes.loansById.get(loanIds[0]) : null;
    const pipeline = loan ? indexes.pipelineByLoanId.get(loan.id) || null : null;
    const tasks = loan ? indexes.tasksByLoanId.get(loan.id) || [] : [];
    resolved.push({
      row,
      loanOfficer: userMatches[0],
      loan,
      pipeline,
      tasks,
      payroll: payrollMatches[0] || null,
    });
  }
  return { resolved, blocked };
}

function summarizePlan(resolved) {
  return {
    acceptedRows: resolved.length,
    loansToCreate: resolved.filter((entry) => !entry.loan).length,
    loansToUpdate: resolved.filter((entry) => entry.loan).length,
    processingTasksToCreate: resolved.filter(
      (entry) => !entry.tasks.some((task) => task.kind === TaskKind.SUBMIT_PROCESSING),
    ).length,
    pipelinesToCreate: resolved.filter((entry) => !entry.pipeline).length,
    pipelinesToUpdate: resolved.filter((entry) => entry.pipeline).length,
    payrollToCreate: resolved.filter((entry) => !entry.payroll).length,
    payrollToUpdate: resolved.filter((entry) => entry.payroll).length,
    zeroAmountLoansToCreate: resolved.filter((entry) => !entry.loan).length,
  };
}

function sameDay(left, right) {
  return dateOnly(left) === dateOnly(right);
}

function verificationFor(resolved) {
  const mismatches = [];
  for (const entry of resolved) {
    const { row, loanOfficer, loan, pipeline, payroll } = entry;
    const fields = [];
    if (!loan) fields.push('loan.missing');
    if (loan && loan.loanNumber !== row.ariveNumber) fields.push('loan.loanNumber');
    if (loan && loan.borrowerName !== row.borrowerName) fields.push('loan.borrowerName');
    if (loan && loan.loanOfficerId !== loanOfficer.id) fields.push('loan.loanOfficerId');
    if (loan?.secondaryLoanOfficerId) fields.push('loan.secondaryLoanOfficerId');
    if (loan && loan.program !== row.loanType) fields.push('loan.program');
    if (!pipeline) fields.push('pipeline.missing');
    if (pipeline && pipeline.sheet !== ProcessingPipelineSheet.FUNDING) fields.push('pipeline.sheet');
    if (pipeline && pipeline.pipelineStatus !== ProcessingPipelineStatus.FUNDED) fields.push('pipeline.pipelineStatus');
    if (pipeline && pipeline.lender !== row.lender) fields.push('pipeline.lender');
    if (pipeline && pipeline.loanType !== row.loanType) fields.push('pipeline.loanType');
    if (pipeline && pipeline.propertyState !== row.propertyState) fields.push('pipeline.propertyState');
    if (pipeline && !sameDay(pipeline.dateAssigned, row.assignedAt)) fields.push('pipeline.dateAssigned');
    if (pipeline && !sameDay(pipeline.fundedAt, row.fundedAt)) fields.push('pipeline.fundedAt');
    if (pipeline && Number(pipeline.finalRevenue) !== row.finalRevenue) fields.push('pipeline.finalRevenue');
    if (!payroll) fields.push('payroll.missing');
    if (payroll && payroll.loanId !== loan?.id) fields.push('payroll.loanId');
    if (payroll && payroll.loanOfficerId !== loanOfficer.id) fields.push('payroll.loanOfficerId');
    if (payroll && payroll.borrowerName !== row.borrowerName) fields.push('payroll.borrowerName');
    if (payroll && payroll.lender !== row.lender) fields.push('payroll.lender');
    if (payroll && payroll.leadSourceDetail !== row.leadSource) fields.push('payroll.leadSourceDetail');
    if (payroll && Number(payroll.expectedRevenue) !== row.finalRevenue) fields.push('payroll.expectedRevenue');
    if (payroll && payroll.status !== PayrollCompRequestStatus.PAID) fields.push('payroll.status');
    if (payroll && !sameDay(payroll.paidAt, row.fundedAt)) fields.push('payroll.paidAt');
    if (fields.length > 0) mismatches.push({ ariveNumber: row.ariveNumber, fields });
  }
  return {
    checked: resolved.length,
    consistent: resolved.length - mismatches.length,
    mismatchCount: mismatches.length,
    mismatches,
  };
}

function importMetadata(row, workbookHash, importedAt) {
  return {
    source: FUNDED_IMPORT_SOURCE,
    workbookSha256: workbookHash,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    importedAt,
    matchKey: row.ariveNumber,
    duplicateRule: 'latest-valid-funded-date',
    loanAmountPlaceholder: false,
  };
}

async function applyEntry(entry, context) {
  const { row, loanOfficer } = entry;
  const importedAt = new Date().toISOString();
  const borrower = splitBorrowerName(row.borrowerName);
  return prisma.$transaction(async (tx) => {
    const loanBefore = entry.loan ? serialize(entry.loan) : null;
    const loan = entry.loan
      ? await tx.loan.update({
          where: { id: entry.loan.id },
          data: {
            loanNumber: row.ariveNumber,
            borrowerName: row.borrowerName,
            borrowerFirstName: borrower.firstName || null,
            borrowerLastName: borrower.lastName || null,
            program: row.loanType,
            loanOfficerId: loanOfficer.id,
            secondaryLoanOfficerId: null,
            stage: 'CLOSED',
          },
        })
      : await tx.loan.create({
          data: {
            loanNumber: row.ariveNumber,
            borrowerName: row.borrowerName,
            borrowerFirstName: borrower.firstName || null,
            borrowerLastName: borrower.lastName || null,
            amount: 0,
            program: row.loanType,
            stage: 'CLOSED',
            loanOfficerId: loanOfficer.id,
          },
        });

    const sourceMetadata = {
      source: FUNDED_IMPORT_SOURCE,
      workbookSha256: context.workbookHash,
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      importedAt,
      authoritative: true,
    };
    const authoritativeSubmission = {
      loanOfficer: loanOfficer.name,
      loanOfficerId: loanOfficer.id,
      secondaryLoanOfficerId: null,
      secondaryLoanOfficerName: 'N/A',
      arriveLoanNumber: row.ariveNumber,
      borrowerFirstName: borrower.firstName,
      borrowerLastName: borrower.lastName,
      leadSource: row.leadSource,
      investor: row.lender,
      lender: row.lender,
      leadSource: row.leadSource,
      loanType: row.loanType,
      propertyState: row.propertyState,
      state: row.propertyState,
      projectedRevenue: String(row.finalRevenue),
      finalRevenue: String(row.finalRevenue),
      fundedAt: row.fundedAt.toISOString(),
      fundedDataImport: sourceMetadata,
    };

    let tasks = await tx.task.findMany({
      where: { loanId: loan.id },
      select: { id: true, kind: true, submissionData: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    let processingTask = tasks.find((task) => task.kind === TaskKind.SUBMIT_PROCESSING);
    if (!processingTask) {
      processingTask = await tx.task.create({
        data: {
          title: 'Historical funded processing import',
          description: 'Synthetic completed processing task created from the authoritative funded workbook.',
          status: TaskStatus.COMPLETED,
          kind: TaskKind.SUBMIT_PROCESSING,
          assignedRole: UserRole.PROCESSOR_JR,
          loanId: loan.id,
          createdAt: row.assignedAt,
          completedAt: row.assignedAt,
          submissionData: {
            ...authoritativeSubmission,
            workflowVersion: 'funded-import-v1',
            processingMethod: entry.pipeline?.processingMethod || null,
          },
        },
        select: { id: true, kind: true, submissionData: true, createdAt: true },
      });
      tasks = [...tasks, processingTask];
    }

    for (const task of tasks) {
      await tx.task.update({
        where: { id: task.id },
        data: {
          submissionData: {
            ...asObject(task.submissionData),
            ...authoritativeSubmission,
          },
        },
      });
    }

    const pipelineData = {
      sourceTaskId: processingTask.id,
      dateAssigned: row.assignedAt,
      sheet: ProcessingPipelineSheet.FUNDING,
      pipelineStatus: ProcessingPipelineStatus.FUNDED,
      statusChangedAt: row.fundedAt,
      loanType: row.loanType,
      propertyState: row.propertyState,
      lender: row.lender,
      projectedRevenue: row.finalRevenue,
      finalRevenue: row.finalRevenue,
      fundedAt: row.fundedAt,
      firstPaymentAt: getMortgageFirstPaymentDateUtc(row.fundedAt),
      sixthPaymentAt: addMonthsClampedUtc(row.fundedAt, 6),
      movedAt: row.fundedAt,
      archivedAt: null,
      ...pipelineLockedDefaults(row.lender, row.fundedAt),
    };
    const pipeline = entry.pipeline
      ? await tx.processingPipelineLoan.update({
          where: { id: entry.pipeline.id },
          data: { ...pipelineData, version: { increment: 1 } },
        })
      : await tx.processingPipelineLoan.create({
          data: {
            loanId: loan.id,
            processingMethod: null,
            ...pipelineData,
          },
        });

    const metadata = {
      ...importMetadata(row, context.workbookHash, importedAt),
      loanAmountPlaceholder: !entry.loan,
      detailedCompensationUnavailable: !entry.payroll,
    };
    const payrollData = {
      loanOfficerId: loanOfficer.id,
      loanId: loan.id,
      loanNumber: row.ariveNumber,
      borrowerName: row.borrowerName,
      loanType: row.loanType || 'Other',
      lender: row.lender || 'Unspecified lender',
      leadSource: payrollLeadSourceFor(row.leadSource),
      leadSourceDetail: row.leadSource,
      leadProvidedBy: payrollLeadProvidedByFor(row.leadSource),
      expectedRevenue: row.finalRevenue,
      status: PayrollCompRequestStatus.PAID,
      paidAt: row.fundedAt,
      fundedImportKey: row.ariveNumber,
      fundedImportMetadata: metadata,
      submitterNotes: entry.payroll?.submitterNotes || 'Historical funded-data backfill; detailed compensation worksheet was not supplied.',
    };
    const payrollBefore = entry.payroll ? serialize(entry.payroll) : null;
    const payroll = entry.payroll
      ? await tx.payrollCompRequest.update({
          where: { id: entry.payroll.id },
          data: payrollData,
        })
      : await tx.payrollCompRequest.create({
          data: {
            ...payrollData,
            loanChannel: PayrollLoanChannel.BROKER,
            processingType: payrollProcessingType(entry.pipeline?.processingMethod),
            submittedAt: row.fundedAt,
          },
        });

    await tx.auditLog.create({
      data: {
        loanId: loan.id,
        userId: context.actor.id,
        action: entry.loan ? 'FUNDED_DATA_BACKFILL_UPDATED' : 'FUNDED_DATA_BACKFILL_CREATED',
        details: JSON.stringify({
          actor: context.actor.name,
          source: sourceMetadata,
          ariveNumber: row.ariveNumber,
          matchMethod: entry.loan ? 'normalized-arive' : 'created-canonical-loan',
          before: { loan: loanBefore, payroll: payrollBefore, pipeline: serialize(entry.pipeline) },
          after: {
            loanId: loan.id,
            processingPipelineLoanId: pipeline.id,
            payrollCompRequestId: payroll.id,
            loanOfficerId: loanOfficer.id,
            lender: row.lender,
            leadSource: row.leadSource,
            assignedAt: row.assignedAt.toISOString(),
            fundedAt: row.fundedAt.toISOString(),
            finalRevenue: row.finalRevenue,
          },
        }),
      },
    });

    return {
      ariveNumber: row.ariveNumber,
      loanId: loan.id,
      pipelineId: pipeline.id,
      payrollId: payroll.id,
      loanCreated: !entry.loan,
      pipelineCreated: !entry.pipeline,
      payrollCreated: !entry.payroll,
    };
  }, { maxWait: 15_000, timeout: 45_000 });
}

async function main() {
  const options = parseArgs();
  const workbookHash = fingerprint(options.workbookPath);
  const workbook = await parseFundedWorkbook(options.workbookPath);
  const indexes = await loadPortalIndexes(workbook.rows);
  const { resolved, blocked } = resolveRows(workbook.rows, indexes);
  const planned = summarizePlan(resolved);
  const verification = verificationFor(resolved);
  const actor = options.apply ? await resolveActor() : null;
  const results = [];
  const failures = [];

  console.log(options.apply ? '\nAPPLY MODE - funded records will be written\n' : '\nDRY RUN - no database writes\n');
  console.log(`Workbook rows:              ${workbook.parsedRowCount}`);
  console.log(`Canonical valid ARIVEs:     ${workbook.rows.length}`);
  console.log(`Invalid rows:               ${workbook.invalid.length}`);
  console.log(`Discarded duplicate rows:   ${workbook.discardedDuplicates.length}`);
  console.log(`Blocked canonical rows:     ${blocked.length}`);
  console.log(`Accepted canonical rows:    ${resolved.length}`);
  console.log(`Loans create/update:        ${planned.loansToCreate}/${planned.loansToUpdate}`);
  console.log(`Pipeline create/update:     ${planned.pipelinesToCreate}/${planned.pipelinesToUpdate}`);
  console.log(`Payroll create/update:      ${planned.payrollToCreate}/${planned.payrollToUpdate}`);
  console.log(`Already fully consistent:   ${verification.consistent}/${verification.checked}`);

  if (options.apply) {
    console.log(`Audit actor:                ${actor.name} <${actor.email}>`);
    for (const entry of resolved) {
      try {
        results.push(await applyEntry(entry, { actor, workbookHash }));
      } catch (error) {
        failures.push({
          ariveNumber: entry.row.ariveNumber,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    workbook: {
      path: options.workbookPath,
      sha256: workbookHash,
      sheets: workbook.sheets,
      rowCount: workbook.parsedRowCount,
    },
    planned,
    verification,
    applied: {
      successCount: results.length,
      failureCount: failures.length,
      results,
      failures,
    },
    invalidRows: workbook.invalid.map((row) => ({
      sheet: row.sourceSheet,
      row: row.sourceRow,
      rawAriveNumber: row.rawAriveNumber,
      reasons: row.reasons,
    })),
    blockedRows: blocked.map(({ row, reasons }) => ({
      sheet: row.sourceSheet,
      row: row.sourceRow,
      ariveNumber: row.ariveNumber,
      loanOfficer: row.loanOfficer,
      reasons,
    })),
    discardedDuplicates: workbook.discardedDuplicates,
    warnings: resolved.flatMap(({ row, loan }) => {
      const warnings = [];
      if (!loan) warnings.push('New loan uses $0 amount placeholder');
      if (row.fundedAt < row.assignedAt) warnings.push('Funded date precedes assigned date');
      if (row.fundedAt > new Date()) warnings.push('Funded date is in the future');
      return warnings.length > 0 ? [{ ariveNumber: row.ariveNumber, warnings }] : [];
    }),
  };
  writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nReport: ${options.reportPath}`);

  if (!options.apply) {
    console.log('Dry run complete. Re-run with --apply only after reviewing the report.');
  } else if (failures.length > 0) {
    throw new Error(`Import completed with ${failures.length} failed ARIVE row(s).`);
  } else {
    console.log(`Import complete. Applied ${results.length} canonical funded record(s).`);
  }
}

main()
  .catch((error) => {
    console.error('Funded data import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
