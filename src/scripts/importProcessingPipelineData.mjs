/**
 * Idempotent current-pipeline spreadsheet backfill.
 *
 * Usage:
 *   npm run import:pipeline -- "C:\path\Updated Pipeline Backfill.xlsx"
 *   npm run import:pipeline -- "C:\path\Updated Pipeline Backfill.xlsx" --apply
 *
 * Dry-run is the default. Rows without one existing portal loan and one
 * unique ARIVE match are quarantined instead of creating incomplete loans.
 * Existing loans without a processing task receive an audited synthetic task.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  PrismaClient,
  ProcessingPipelineSheet,
  ProcessingPipelineStatus,
  TaskKind,
  UserRole,
} from '@prisma/client';
import {
  cleanText,
  normalizeAriveNumber,
  parseProcessingPipelineWorkbook,
} from '../lib/processingPipelineBackfill.mjs';

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
    // Prisma reports a clear error when DATABASE_URL is unavailable.
  }
}

loadDotEnv(resolve(process.cwd(), '.env'));
const prisma = new PrismaClient();

function parseArgs() {
  const args = process.argv.slice(2);
  const workbookPath = args.find((arg) => !arg.startsWith('--'));
  if (!workbookPath) throw new Error('Workbook path is required.');
  const reportArg = args.indexOf('--report');
  const absoluteWorkbookPath = resolve(workbookPath);
  return {
    workbookPath: absoluteWorkbookPath,
    apply: args.includes('--apply'),
    reportPath:
      reportArg >= 0 && args[reportArg + 1]
        ? resolve(args[reportArg + 1])
        : join(
            dirname(absoluteWorkbookPath),
            `${basename(absoluteWorkbookPath, '.xlsx')}.pipeline-import-report.json`,
          ),
  };
}

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nameKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseOptionalBoolean(value) {
  if (typeof value === 'boolean') return value;
  const key = cleanText(value).toLowerCase();
  if (['true', 'yes', 'y', '1'].includes(key)) return true;
  if (['false', 'no', 'n', '0'].includes(key)) return false;
  return null;
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

function sheetForStatus(status) {
  if (status === ProcessingPipelineStatus.FUNDED) return ProcessingPipelineSheet.FUNDING;
  if (
    status === ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE ||
    status === ProcessingPipelineStatus.ADVERSE_PENDING ||
    status === ProcessingPipelineStatus.PENDING_APPROVAL
  ) {
    return ProcessingPipelineSheet.RESTRUCTURE;
  }
  return ProcessingPipelineSheet.PIPELINE;
}

function assignmentGroupForSenior(value) {
  const key = nameKey(value);
  if (key === 'kathy' || key === 'kathybui') return 'KATHY_BUI';
  if (key === 'jack' || key === 'jackngo') return 'JACK_NGO';
  if (key === 'martin' || key === 'martinbui' || key === 'martinsonbui') {
    return 'MARTIN_SON_BUI';
  }
  return null;
}

function specialLenderDefaults(lender, processingMethod, confirmedAt) {
  const normalized = cleanText(lender).toUpperCase().replace(/[^A-Z0-9]+/g, ' ');
  const special = ['AVEN', 'FIGURE', 'NFTY'].some(
    (name) => normalized === name || normalized.startsWith(`${name} `),
  );
  if (special) {
    return {
      titleStatus: 'RECEIVED',
      payoffStatus: 'RECEIVED',
      payoffOrderedAt: null,
      hoiStatus: 'RECEIVED',
      hoiOrderedAt: null,
      appraisalNeeded: false,
      cdSent: true,
      cdWarningStartsAt: null,
      rateLock: true,
      rateLockExpiresAt: null,
      rateLockConfirmedAt: confirmedAt,
      rateLockRequestedAt: null,
      rateLockRequestedById: null,
    };
  }
  if (processingMethod === 'THIRD_PARTY') {
    return {
      titleStatus: 'NOT_APPLICABLE',
      payoffStatus: 'NOT_APPLICABLE',
      payoffOrderedAt: null,
      hoiStatus: 'NOT_APPLICABLE',
      hoiOrderedAt: null,
    };
  }
  return {};
}

function resolvePerson(users, value, role) {
  const key = nameKey(value);
  if (!key) return { user: null, resolution: 'BLANK' };
  const eligible = users.filter(
    (user) => user.role === role || user.roles.includes(role),
  );
  const exact = eligible.filter((user) => nameKey(user.name) === key);
  if (exact.length === 1) return { user: exact[0], resolution: 'EXACT' };
  if (exact.length > 1) return { user: null, resolution: 'AMBIGUOUS_EXACT' };
  const firstName = eligible.filter(
    (user) => nameKey(user.name.split(/\s+/)[0]) === key,
  );
  if (firstName.length === 1) return { user: firstName[0], resolution: 'UNIQUE_FIRST_NAME' };
  return {
    user: null,
    resolution: firstName.length > 1 ? 'AMBIGUOUS_FIRST_NAME' : 'MISSING',
  };
}

async function loadIndexes() {
  const [users, loans, tasks, pipelines] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roles: true,
        processingAssignmentGroups: true,
      },
    }),
    prisma.loan.findMany({
      select: {
        id: true,
        loanNumber: true,
        borrowerName: true,
        program: true,
        loanOfficerId: true,
        secondaryLoanOfficerId: true,
      },
    }),
    prisma.task.findMany({
      where: { kind: TaskKind.SUBMIT_PROCESSING },
      select: {
        id: true,
        loanId: true,
        assignedUserId: true,
        submissionData: true,
        createdAt: true,
        completedAt: true,
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    }),
    prisma.processingPipelineLoan.findMany(),
  ]);

  const loansById = new Map(loans.map((loan) => [loan.id, loan]));
  const loanIdsByArive = new Map();
  const addLoanKey = (value, loanId) => {
    const key = normalizeAriveNumber(value);
    if (!key) return;
    const ids = loanIdsByArive.get(key) || new Set();
    ids.add(loanId);
    loanIdsByArive.set(key, ids);
  };
  for (const loan of loans) addLoanKey(loan.loanNumber, loan.id);
  for (const task of tasks) addLoanKey(loanNumberFromSubmission(task.submissionData), task.loanId);

  const tasksByLoanId = new Map();
  for (const task of tasks) {
    const existing = tasksByLoanId.get(task.loanId) || [];
    existing.push(task);
    tasksByLoanId.set(task.loanId, existing);
  }
  return {
    users,
    loansById,
    loanIdsByArive,
    tasksByLoanId,
    pipelineByLoanId: new Map(pipelines.map((pipeline) => [pipeline.loanId, pipeline])),
  };
}

function resolveTbdAppraisal(row, pipeline, task) {
  if (!row.appraisalTbd) {
    return {
      appraisalNeeded: row.appraisalNeeded,
      appraisalNotes: row.appraisalNotes,
      source: 'WORKBOOK',
    };
  }
  const data = asObject(task?.submissionData);
  const taskNeeded = parseOptionalBoolean(data.appraisalNeeded);
  const taskWaiver = parseOptionalBoolean(data.appraisalWaiver);
  const taskDerived = taskNeeded ?? (taskWaiver === null ? null : !taskWaiver);
  const appraisalNeeded = pipeline?.appraisalNeeded ?? taskDerived;
  const pipelineNotes = cleanText(pipeline?.appraisalNotes);
  const taskNotes = cleanText(data.appraisalNotes);
  return {
    appraisalNeeded: appraisalNeeded ?? (row.appraisalBackAt ? true : null),
    appraisalNotes: pipelineNotes || taskNotes || null,
    source:
      pipeline?.appraisalNeeded !== null && pipeline?.appraisalNeeded !== undefined
        ? 'EXISTING_PIPELINE'
        : taskDerived !== null
          ? 'PROCESSING_TASK'
          : row.appraisalBackAt
            ? 'APPRAISAL_BACK_DATE'
            : 'UNRESOLVED',
  };
}

function combineNotes(...values) {
  const unique = [...new Set(values.map(cleanText).filter(Boolean))];
  return unique.join(' | ') || null;
}

function inferredAppraisalOrderedAt(entry) {
  return (
    entry.row.appraisalOrderedDerived ||
    (
      entry.appraisal.appraisalNeeded === true &&
      !entry.row.appraisalOrderedAt &&
      !entry.pipeline?.appraisalOrderedAt
    )
  );
}

function resolveRows(workbook, indexes) {
  const accepted = [];
  const blocked = [];
  for (const row of workbook.rows) {
    const loanIds = [...(indexes.loanIdsByArive.get(row.ariveNumber) || [])];
    const reasons = [];
    if (loanIds.length === 0) reasons.push('No existing portal loan matches ARIVE');
    if (loanIds.length > 1) reasons.push('ARIVE matches multiple portal loans');
    const loan = loanIds.length === 1 ? indexes.loansById.get(loanIds[0]) : null;
    const pipeline = loan ? indexes.pipelineByLoanId.get(loan.id) || null : null;
    const processingTasks = loan ? indexes.tasksByLoanId.get(loan.id) || [] : [];
    const task =
      processingTasks.find((candidate) => candidate.id === pipeline?.sourceTaskId) ||
      processingTasks[0] ||
      null;
    if (reasons.length > 0) {
      blocked.push({ row, reasons });
      continue;
    }

    const junior = resolvePerson(indexes.users, row.juniorProcessor, UserRole.PROCESSOR_JR);
    const senior = resolvePerson(indexes.users, row.seniorProcessor, UserRole.PROCESSOR_SR);
    const appraisal = resolveTbdAppraisal(row, pipeline, task);
    const warnings = [];
    if (!junior.user) warnings.push(`Jr Processor ${row.juniorProcessor}: ${junior.resolution}`);
    if (!senior.user) warnings.push(`Processor ${row.seniorProcessor}: ${senior.resolution}`);
    if (!task) warnings.push('A synthetic completed Submit to Processing task is required');
    if (appraisal.source === 'UNRESOLVED') warnings.push('Appraisal TBD could not be resolved');
    if (!row.loanType) warnings.push('Loan Type is blank; preserving portal value');
    if (!row.propertyState) warnings.push('State is blank; preserving portal value');
    if (row.cdSent === null) warnings.push('CD Sent is blank; preserving portal value');
    if (row.rateLock === null) warnings.push('Rate Lock is blank; preserving portal value');
    if (row.appraisalBackNote) {
      warnings.push(`Appraisal Back text moved to notes: ${row.appraisalBackNote}`);
    }

    const assignmentGroup =
      assignmentGroupForSenior(row.seniorProcessor) || pipeline?.assignmentGroup || null;
    accepted.push({
      row,
      loan,
      task,
      pipeline,
      junior,
      senior,
      appraisal,
      assignmentGroup,
      warnings,
    });
  }
  return { accepted, blocked };
}

function buildPipelineData(entry) {
  const { row, loan, task, pipeline, junior, senior, appraisal, assignmentGroup } = entry;
  const statusChangedAt = pipeline?.statusChangedAt || row.assignedAt;
  const processingMethod = assignmentGroup
    ? 'IN_HOUSE'
    : pipeline?.processingMethod || null;
  const appraisalNeeded =
    appraisal.appraisalNeeded ?? pipeline?.appraisalNeeded ?? null;
  const appraisalOrderedAt =
    appraisalNeeded === true
      ? row.appraisalOrderedAt ||
        pipeline?.appraisalOrderedAt ||
        new Date(row.assignedAt.getTime() + 3 * 86_400_000)
      : null;
  const rateLock = row.rateLock ?? pipeline?.rateLock ?? false;
  const rateLockConfirmedAt = rateLock
    ? pipeline?.rateLockConfirmedAt || row.assignedAt
    : null;
  const titleStatus = row.titleStatus;
  const payoffStatus = row.payoffStatus;
  const hoiStatus = row.hoiStatus;
  const data = {
    sourceTaskId: task?.id || null,
    seniorProcessorId: senior.user?.id || pipeline?.seniorProcessorId || null,
    juniorProcessorId:
      junior.user?.id || pipeline?.juniorProcessorId || task?.assignedUserId || null,
    assignmentGroup,
    processingMethod,
    dateAssigned: row.assignedAt,
    sheet: sheetForStatus(row.pipelineStatus),
    pipelineStatus: row.pipelineStatus,
    statusChangedAt,
    titleStatus,
    payoffStatus,
    payoffOrderedAt:
      payoffStatus === 'ORDERED'
        ? pipeline?.payoffOrderedAt || row.assignedAt
        : null,
    hoiStatus,
    hoiOrderedAt:
      hoiStatus === 'ORDERED'
        ? pipeline?.hoiOrderedAt || row.assignedAt
        : null,
    appraisalNeeded,
    appraisalNotes: combineNotes(
      appraisal.appraisalNotes,
      row.appraisalBackNote,
    ),
    appraisalOrderedAt,
    appraisalBackAt: row.appraisalBackAt,
    cdSent: row.cdSent ?? pipeline?.cdSent ?? false,
    missingItemsCurrentStatus: row.missingItemsCurrentStatus,
    extraNotes: row.extraNotes,
    rateLock,
    rateLockExpiresAt: rateLock ? pipeline?.rateLockExpiresAt || null : null,
    rateLockConfirmedAt,
    approvedWithConditionsAt:
      row.pipelineStatus === ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS
        ? pipeline?.approvedWithConditionsAt || statusChangedAt
        : pipeline?.approvedWithConditionsAt || null,
    loanType: row.loanType || pipeline?.loanType || loan.program || null,
    propertyState: row.propertyState || pipeline?.propertyState || null,
    lender: row.lender || pipeline?.lender || null,
    archivedAt: null,
    archivedById: null,
    ...specialLenderDefaults(row.lender, processingMethod, rateLockConfirmedAt),
  };
  return data;
}

function comparableValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof value.toJSON === 'function') {
    return value.toJSON();
  }
  return value;
}

function changedPipelineFields(entry) {
  if (!entry.pipeline) return ['pipeline.missing'];
  const data = buildPipelineData(entry);
  return Object.entries(data)
    .filter(([field, value]) => comparableValue(entry.pipeline[field]) !== comparableValue(value))
    .map(([field]) => field);
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
  if (!actors[0]) throw new Error('No active Admin II/III user is available for auditing.');
  return actors[0];
}

async function applyEntry(entry, context) {
  return prisma.$transaction(async (tx) => {
    const task = entry.task || await tx.task.create({
      data: {
        title: 'Historical current pipeline import',
        description:
          'Synthetic completed processing task created from the authoritative current pipeline workbook.',
        status: 'COMPLETED',
        kind: TaskKind.SUBMIT_PROCESSING,
        assignedRole: UserRole.PROCESSOR_JR,
        assignedUserId: entry.junior.user?.id || null,
        loanId: entry.loan.id,
        createdAt: entry.row.assignedAt,
        completedAt: entry.row.assignedAt,
        submissionData: {
          workflowVersion: 'pipeline-import-v1',
          arriveLoanNumber: entry.row.ariveNumber,
          borrowerName: entry.row.borrowerName,
          investor: entry.row.lender,
          lender: entry.row.lender,
          loanType: entry.row.loanType,
          propertyState: entry.row.propertyState,
          state: entry.row.propertyState,
          processingMethod: entry.assignmentGroup ? 'IN_HOUSE' : null,
          processingAssignmentGroup: entry.assignmentGroup,
          appraisalNeeded: entry.appraisal.appraisalNeeded,
          appraisalNotes: entry.appraisal.appraisalNotes,
          pipelineBackfill: {
            workbookSha256: context.workbookHash,
            sourceSheet: entry.row.sourceSheet,
            sourceRow: entry.row.sourceRow,
          },
        },
      },
    });
    const data = buildPipelineData({ ...entry, task });
    const before = entry.pipeline
      ? JSON.parse(JSON.stringify(entry.pipeline, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value))
      : null;
    const pipeline = entry.pipeline
      ? await tx.processingPipelineLoan.update({
          where: { id: entry.pipeline.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await tx.processingPipelineLoan.create({
          data: { loanId: entry.loan.id, ...data },
        });
    await tx.auditLog.create({
      data: {
        loanId: entry.loan.id,
        userId: context.actor.id,
        action: entry.pipeline
          ? 'PROCESSING_PIPELINE_BACKFILL_UPDATED'
          : 'PROCESSING_PIPELINE_BACKFILL_CREATED',
        details: JSON.stringify({
          actor: context.actor.name,
          workbookSha256: context.workbookHash,
          sourceSheet: entry.row.sourceSheet,
          sourceRow: entry.row.sourceRow,
          ariveNumber: entry.row.ariveNumber,
          tbdAppraisalResolution: entry.appraisal.source,
          inferredAppraisalOrderedAt: inferredAppraisalOrderedAt(entry),
          before,
          after: data,
        }),
      },
    });
    return {
      ariveNumber: entry.row.ariveNumber,
      pipelineId: pipeline.id,
      created: !entry.pipeline,
    };
  }, { maxWait: 15_000, timeout: 45_000 });
}

async function main() {
  const options = parseArgs();
  const workbookHash = fingerprint(options.workbookPath);
  const workbook = await parseProcessingPipelineWorkbook(options.workbookPath);
  const indexes = await loadIndexes();
  const { accepted, blocked } = resolveRows(workbook, indexes);
  const acceptedWithChanges = accepted.map((entry) => ({
    ...entry,
    changedFields: changedPipelineFields(entry),
  }));
  const entriesToApply = acceptedWithChanges.filter(
    (entry) => entry.changedFields.length > 0,
  );
  const actor = options.apply && entriesToApply.length > 0 ? await resolveActor() : null;
  const results = [];
  const failures = [];

  console.log(options.apply
    ? '\nAPPLY MODE - processing pipeline records will be written\n'
    : '\nDRY RUN - no database writes\n');
  console.log(`Workbook keyed rows:        ${workbook.parsedRowCount}`);
  console.log(`Canonical valid rows:       ${workbook.rows.length}`);
  console.log(`Invalid workbook rows:      ${workbook.invalid.length}`);
  console.log(`Duplicate ARIVE groups:     ${workbook.duplicates.length}`);
  console.log(`Blocked portal matches:     ${blocked.length}`);
  console.log(`Accepted rows:              ${accepted.length}`);
  console.log(`Pipeline create/update:     ${entriesToApply.filter((entry) => !entry.pipeline).length}/${entriesToApply.filter((entry) => entry.pipeline).length}`);
  console.log(`Already consistent:         ${acceptedWithChanges.filter((entry) => entry.changedFields.length === 0).length}`);
  console.log(`Rows with warnings:         ${accepted.filter((entry) => entry.warnings.length > 0).length}`);

  if (options.apply) {
    if (actor) console.log(`Audit actor:                ${actor.name} <${actor.email}>`);
    for (const entry of entriesToApply) {
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
      keyedRows: workbook.parsedRowCount,
    },
    summary: {
      canonicalValidRows: workbook.rows.length,
      invalidWorkbookRows: workbook.invalid.length,
      duplicateAriveGroups: workbook.duplicates.length,
      blockedPortalMatches: blocked.length,
      acceptedRows: accepted.length,
      pipelinesToCreate: entriesToApply.filter((entry) => !entry.pipeline).length,
      pipelinesToUpdate: entriesToApply.filter((entry) => entry.pipeline).length,
      alreadyConsistent: acceptedWithChanges.filter(
        (entry) => entry.changedFields.length === 0,
      ).length,
      rowsWithWarnings: accepted.filter((entry) => entry.warnings.length > 0).length,
      unresolvedTbdAppraisals: accepted.filter(
        (entry) => entry.appraisal.source === 'UNRESOLVED',
      ).length,
    },
    invalidRows: workbook.invalid.map((row) => ({
      sheet: row.sourceSheet,
      row: row.sourceRow,
      rawAriveNumber: row.rawAriveNumber,
      borrowerName: row.borrowerName,
      reasons: row.reasons,
    })),
    duplicates: workbook.duplicates,
    ignoredRows: workbook.ignoredRows,
    blockedRows: blocked.map(({ row, reasons }) => ({
      sheet: row.sourceSheet,
      row: row.sourceRow,
      ariveNumber: row.ariveNumber,
      borrowerName: row.borrowerName,
      reasons,
    })),
    acceptedRows: acceptedWithChanges.map((entry) => ({
      sheet: entry.row.sourceSheet,
      row: entry.row.sourceRow,
      ariveNumber: entry.row.ariveNumber,
      borrowerName: entry.row.borrowerName,
      existingPipeline: Boolean(entry.pipeline),
      juniorProcessor: {
        workbook: entry.row.juniorProcessor,
        matched: entry.junior.user?.name || null,
        resolution: entry.junior.resolution,
      },
      seniorProcessor: {
        workbook: entry.row.seniorProcessor,
        matched: entry.senior.user?.name || null,
        resolution: entry.senior.resolution,
      },
      tbdAppraisalResolution: entry.appraisal.source,
      inferredAppraisalOrderedAt: inferredAppraisalOrderedAt(entry),
      changedFields: entry.changedFields,
      warnings: entry.warnings,
      mappedData: buildPipelineData(entry),
    })),
    applied: {
      successCount: results.length,
      failureCount: failures.length,
      results,
      failures,
    },
  };
  writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nReport: ${options.reportPath}`);

  if (!options.apply) {
    console.log('Dry run complete. Review the report before using --apply.');
  } else if (failures.length > 0) {
    throw new Error(`Import completed with ${failures.length} failed row(s).`);
  } else {
    console.log(`Import complete. Applied ${results.length} processing pipeline row(s).`);
  }
}

main()
  .catch((error) => {
    console.error('Processing pipeline import failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
