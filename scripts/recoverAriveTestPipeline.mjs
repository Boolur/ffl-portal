// One-off recovery for the explicitly authorized TESTING TESTER file only.
// Dry run by default. No Arive requests, notifications, payroll changes, or credential output.
// node scripts/recoverAriveTestPipeline.mjs --env-file <local .env path> [--apply]
// node scripts/recoverAriveTestPipeline.mjs --self-test
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

const TARGET = Object.freeze({
  loanNumber: '17881588', loanId: 'e29decf7-02e7-4032-929f-348e0822868f',
  borrowerName: 'TESTING TESTER', ownerId: '2e28c6a5-67c0-442d-94bd-59897ad8d8cd',
  packageId: '9e1e3bf6-9aa0-4bc0-a254-7036ef4542c7', packageRevision: 31,
  oldRequestId: '022123b3-ad09-4592-b6b3-901ed6ed8fe1',
  oldPipelineId: '5775fac3-d362-49f5-bc13-c027d3e6dc0d',
  originalAuditId: 'c6e5aa40-701c-41c4-a736-86e08775d324',
  seniorId: 'a85c6d82-3de5-4cc6-9710-dc30bab04e40',
  assignmentGroup: 'MARTIN_SON_BUI', processingMethod: 'IN_HOUSE',
});
const RECOVERY_ACTION = 'ARIVE_TEST_PIPELINE_RECOVERED';
const RECOVERY_TITLE = 'Submit to Processing — recovered TESTING TESTER request';
const RECOVERY_NOTE = 'Administrative recovery of the deleted TESTING TESTER processing request. This is a new replacement request linked to the surviving approved document package; its documents and review history have been preserved. The original submission details and task conversation are unavailable and have not been recreated. Only existing loan information and verified original routing were copied. Pending Approval is a recovery placeholder; Arive currently reports application intake and its milestones have not been synchronized. Financial amounts, service progress, and milestone dates that could not be recovered remain unset or at their initial defaults.';
class RecoveryError extends Error {}
function requireCondition(condition, code) { if (!condition) throw new RecoveryError(code); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function parseDetails(value) { try { return object(JSON.parse(value || '{}')); } catch { return {}; } }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function validateState(state) {
  const { loan, originalAudit, owner, senior, recoveryAudits } = state;
  requireCondition(loan && loan.id === TARGET.loanId && loan.loanNumber === TARGET.loanNumber && loan.loanOfficerId === TARGET.ownerId && loan.borrowerName.trim().toUpperCase() === TARGET.borrowerName, 'TARGET_LOAN_IDENTITY_MISMATCH');
  requireCondition(owner?.id === TARGET.ownerId && owner.active && [owner.role, ...owner.roles].some(r => r === 'ADMIN_III' || r === 'ADMIN'), 'AUTHORIZED_OWNER_UNAVAILABLE');
  const packageTask = loan.tasks.find(t => t.id === TARGET.packageId);
  const pkg = object(packageTask?.submissionData).submissionPilot;
  requireCondition(packageTask && packageTask.kind === null && packageTask.title === 'Processing submission pilot — documents' && packageTask.parentTaskId === null && pkg?.version === 1, 'EXPECTED_PACKAGE_UNAVAILABLE');
  const requests = loan.tasks.filter(t => t.kind === 'SUBMIT_PROCESSING');
  if (recoveryAudits.length) {
    requireCondition(recoveryAudits.length === 1, 'AMBIGUOUS_PRIOR_RECOVERY');
    const audit = parseDetails(recoveryAudits[0].details);
    const request = requests.find(t => t.id === audit.newRequestId);
    requireCondition(audit.recoveryVersion === 1 && audit.oldRequestId === TARGET.oldRequestId && audit.oldPipelineId === TARGET.oldPipelineId && audit.packageId === TARGET.packageId && request && requests.length === 1 && request.title === RECOVERY_TITLE && object(request.submissionData).processingDocumentTaskId === TARGET.packageId && loan.processingPipeline?.id === audit.newPipelineId && loan.processingPipeline.sourceTaskId === request.id, 'PRIOR_RECOVERY_RECORDS_CHANGED_OR_MISSING');
    return { alreadyRecovered: true, requestId: request.id, pipelineId: loan.processingPipeline.id, packageTask, pkg };
  }
  requireCondition(!loan.processingPipeline && requests.length === 0, 'EXISTING_PIPELINE_OR_PROCESSING_REQUEST');
  requireCondition(loan.stage === 'PROCESSING', 'LOAN_STAGE_CHANGED');
  requireCondition(packageTask.status === 'COMPLETED' && pkg.state === 'APPROVED' && pkg.revision === TARGET.packageRevision && pkg.reviewerId === TARGET.ownerId && Array.isArray(pkg.items) && pkg.items.length === 7 && pkg.items.every(i => i.review === 'APPROVED' && Array.isArray(i.files) && (i.files.length > 0 || (typeof i.waiver === 'string' && i.waiver.trim()))), 'APPROVED_PACKAGE_CHANGED');
  requireCondition(originalAudit?.id === TARGET.originalAuditId && originalAudit.loanId === TARGET.loanId && originalAudit.action === 'PROCESSING_PIPELINE_CREATED', 'ORIGINAL_ROUTING_AUDIT_UNAVAILABLE');
  const routing = parseDetails(originalAudit.details);
  requireCondition(routing.sourceTaskId === TARGET.oldRequestId && routing.processingPipelineLoanId === TARGET.oldPipelineId && routing.assignmentGroup === TARGET.assignmentGroup && routing.processingMethod === TARGET.processingMethod && routing.seniorProcessorId === TARGET.seniorId && routing.assignmentResolution === 'MATCHED_BY_GROUP', 'ORIGINAL_ROUTING_AUDIT_MISMATCH');
  requireCondition(senior?.id === TARGET.seniorId && senior.active && [senior.role, ...senior.roles].includes('PROCESSOR_SR'), 'ORIGINAL_SENIOR_PROCESSOR_UNAVAILABLE');
  return { alreadyRecovered: false, packageTask, pkg, routing };
}

function storageResult(response, file) {
  if (response.error) return Number(response.error.statusCode ?? response.error.status) === 404 ? 'missing' : 'storageErrors';
  if (!response.data) return 'missing';
  const size = response.data.size ?? response.data.metadata?.size;
  const type = response.data.contentType ?? response.data.metadata?.mimetype;
  if (size === undefined || size === null || type === undefined || type === null) return 'incomplete';
  return Number(size) === file.size && type === file.type ? 'matching' : 'mismatch';
}

function validateFile(file) {
  requireCondition(file && typeof file.path === 'string' && !file.path.includes('..') && !file.path.includes('\\') && (file.path.startsWith(`processing-submission/${TARGET.ownerId}/`) || file.path.startsWith(`submission-pilot/${TARGET.packageId}/`)), 'FILE_OWNERSHIP_REFERENCE_INVALID');
  requireCondition(Number.isInteger(file.size) && file.size > 0 && file.size <= 20 * 1024 * 1024 && ['application/pdf', 'image/jpeg', 'image/png'].includes(file.type), 'FILE_METADATA_REFERENCE_INVALID');
}

async function verifyStorage(pkg) {
  const active = pkg.items.flatMap(i => i.files);
  const retired = Array.isArray(pkg.retiredFiles) ? pkg.retiredFiles : [];
  [...active, ...retired].forEach(validateFile);
  requireCondition(active.length === 7 && retired.length === 5, 'EXPECTED_FILE_COUNTS_CHANGED');
  requireCondition(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY, 'LOCAL_STORAGE_CONFIGURATION_UNAVAILABLE');
  const storageUrl = new URL(process.env.SUPABASE_URL);
  requireCondition(storageUrl.protocol === 'https:' && !storageUrl.username && !storageUrl.password, 'LOCAL_STORAGE_CONFIGURATION_INVALID');
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) },
  });
  const storage = client.storage.from(process.env.SUPABASE_STORAGE_BUCKET_TASK_ATTACHMENTS || 'task-attachments');
  const results = {};
  for (const [group, files] of [['active', active], ['retired', retired]]) {
    const counts = { total: files.length, matching: 0, missing: 0, mismatch: 0, incomplete: 0, storageErrors: 0 };
    for (const file of files) {
      try { counts[storageResult(await storage.info(file.path), file)]++; }
      catch { counts.storageErrors++; }
    }
    results[group] = counts;
  }
  return results;
}

async function loadState(tx) {
  const loan = await tx.loan.findUnique({ where: { loanNumber: TARGET.loanNumber }, select: {
    id: true, loanNumber: true, borrowerName: true, borrowerFirstName: true, borrowerLastName: true,
    borrowerPhone: true, borrowerEmail: true, amount: true, program: true, propertyAddress: true,
    loanOfficerId: true, stage: true,
    processingPipeline: { select: { id: true, sourceTaskId: true, sheet: true, pipelineStatus: true, archivedAt: true } },
    tasks: { select: { id: true, kind: true, title: true, status: true, parentTaskId: true, submissionData: true, updatedAt: true }, orderBy: { id: 'asc' } },
  } });
  const originalAudit = await tx.auditLog.findUnique({ where: { id: TARGET.originalAuditId }, select: { id: true, loanId: true, action: true, createdAt: true, details: true } });
  const owner = await tx.user.findUnique({ where: { id: TARGET.ownerId }, select: { id: true, name: true, active: true, role: true, roles: true } });
  const senior = await tx.user.findUnique({ where: { id: TARGET.seniorId }, select: { id: true, active: true, role: true, roles: true } });
  const recoveryAudits = await tx.auditLog.findMany({ where: { loanId: TARGET.loanId, action: RECOVERY_ACTION }, select: { id: true, details: true } });
  return { loan, originalAudit, owner, senior, recoveryAudits };
}

function recoveryData(state, now) {
  const { loan, owner } = state;
  const submissionData = {
    processingDocumentTaskId: TARGET.packageId,
    processingMethod: TARGET.processingMethod, processingMethodLabel: 'In-House',
    processingAssignmentGroup: TARGET.assignmentGroup, processingAssignmentLabel: 'Martin Son Bui',
    loanOfficerId: TARGET.ownerId, loanOfficer: owner.name, loanOfficerName: owner.name,
    loanAmount: loan.amount.toString(),
    ...(loan.borrowerFirstName ? { borrowerFirstName: loan.borrowerFirstName } : {}),
    ...(loan.borrowerLastName ? { borrowerLastName: loan.borrowerLastName } : {}),
    ...(loan.borrowerPhone ? { borrowerPhone: loan.borrowerPhone } : {}),
    ...(loan.borrowerEmail ? { borrowerEmail: loan.borrowerEmail } : {}),
    ...(loan.program ? { loanProgram: loan.program } : {}),
    ...(loan.propertyAddress ? { propertyAddress: loan.propertyAddress } : {}),
    notesGoals: RECOVERY_NOTE,
    notesHistory: [{ author: owner.name, role: 'ADMIN_III', message: RECOVERY_NOTE, date: now.toISOString(), entryType: 'note' }],
    lifecycleHistory: [{ id: randomUUID(), at: now.toISOString(), actorName: owner.name, actorRole: 'ADMIN_III', eventType: 'SYSTEM', toStatus: 'COMPLETED', toWorkflow: 'NONE', toAssignedUserId: TARGET.ownerId, toAssignedRole: 'PROCESSOR_JR', note: RECOVERY_NOTE }],
  };
  return {
    task: { loanId: TARGET.loanId, title: RECOVERY_TITLE, description: RECOVERY_NOTE, kind: 'SUBMIT_PROCESSING', status: 'COMPLETED', workflowState: 'NONE', assignedUserId: TARGET.ownerId, assignedRole: 'PROCESSOR_JR', completedAt: now, submissionData },
    pipeline: {
      loanId: TARGET.loanId, seniorProcessorId: TARGET.seniorId, juniorProcessorId: TARGET.ownerId,
      assignmentGroup: TARGET.assignmentGroup, processingMethod: TARGET.processingMethod,
      sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', dateAssigned: now, statusChangedAt: now,
      extraNotes: RECOVERY_NOTE, projectedRevenue: null, finalRevenue: null,
      fundedAt: null, firstPaymentAt: null, sixthPaymentAt: null, archivedAt: null,
    },
  };
}

function selfTest() {
  const file = { size: 123, type: 'application/pdf' };
  assert.equal(storageResult({ data: { size: 123, contentType: file.type }, error: null }, file), 'matching');
  assert.equal(storageResult({ data: { metadata: { size: 123, mimetype: file.type } }, error: null }, file), 'matching');
  assert.equal(storageResult({ data: { size: 122, contentType: file.type }, error: null }, file), 'mismatch');
  assert.equal(storageResult({ data: { size: 123, contentType: 'image/png' }, error: null }, file), 'mismatch');
  assert.equal(storageResult({ data: {}, error: null }, file), 'incomplete');
  assert.equal(storageResult({ data: null, error: { statusCode: 404 } }, file), 'missing');
  assert.equal(storageResult({ data: null, error: { statusCode: 503 } }, file), 'storageErrors');
  assert.throws(() => validateFile({ ...file, path: 'another-user/private-file' }), RecoveryError);
  const state = {
    loan: { id: TARGET.loanId, loanNumber: TARGET.loanNumber, borrowerName: TARGET.borrowerName, loanOfficerId: TARGET.ownerId, stage: 'PROCESSING', amount: 100, processingPipeline: null, tasks: [{ id: TARGET.packageId, kind: null, title: 'Processing submission pilot — documents', status: 'COMPLETED', parentTaskId: null, submissionData: { submissionPilot: { version: 1, revision: 31, state: 'APPROVED', reviewerId: TARGET.ownerId, items: Array.from({ length: 7 }, () => ({ review: 'APPROVED', files: [], waiver: 'Synthetic fixture' })) } } }] },
    owner: { id: TARGET.ownerId, active: true, role: 'ADMIN_III', roles: [], name: 'Synthetic admin' },
    senior: { id: TARGET.seniorId, active: true, role: 'PROCESSOR_SR', roles: [] },
    originalAudit: { id: TARGET.originalAuditId, loanId: TARGET.loanId, action: 'PROCESSING_PIPELINE_CREATED', details: JSON.stringify({ sourceTaskId: TARGET.oldRequestId, processingPipelineLoanId: TARGET.oldPipelineId, assignmentGroup: TARGET.assignmentGroup, processingMethod: TARGET.processingMethod, seniorProcessorId: TARGET.seniorId, assignmentResolution: 'MATCHED_BY_GROUP' }) }, recoveryAudits: [],
  };
  assert.equal(validateState(state).alreadyRecovered, false);
  for (const mutate of [s => { s.loan.loanNumber = '999'; }, s => { s.loan.loanOfficerId = 'another-user'; }, s => { s.loan.borrowerName = 'OTHER PERSON'; }, s => { s.loan.processingPipeline = { id: 'existing' }; }, s => { s.loan.tasks.push({ id: 'existing', kind: 'SUBMIT_PROCESSING' }); }, s => { s.loan.tasks[0].submissionData.submissionPilot.state = 'REVIEW'; }, s => { s.originalAudit.details = '{}'; }]) {
    const invalid = structuredClone(state); mutate(invalid); assert.throws(() => validateState(invalid), RecoveryError);
  }
  const recovered = structuredClone(state);
  recovered.loan.tasks.push({ id: 'new-request', kind: 'SUBMIT_PROCESSING', title: RECOVERY_TITLE, submissionData: { processingDocumentTaskId: TARGET.packageId } });
  recovered.loan.processingPipeline = { id: 'new-pipeline', sourceTaskId: 'new-request' };
  recovered.recoveryAudits.push({ details: JSON.stringify({ recoveryVersion: 1, oldRequestId: TARGET.oldRequestId, oldPipelineId: TARGET.oldPipelineId, packageId: TARGET.packageId, newRequestId: 'new-request', newPipelineId: 'new-pipeline' }) });
  assert.equal(validateState(recovered).alreadyRecovered, true);
  recovered.loan.processingPipeline = null;
  assert.throws(() => validateState(recovered), RecoveryError);
  const data = recoveryData(state, new Date('2026-11-06T00:00:00Z'));
  assert.equal(data.task.status, 'COMPLETED');
  assert.equal(data.task.submissionData.processingDocumentTaskId, TARGET.packageId);
  assert.equal(data.pipeline.pipelineStatus, 'PENDING_APPROVAL');
  assert.equal(data.pipeline.finalRevenue, null);
  assert.equal(data.pipeline.fundedAt, null);
  assert.equal(data.task.loanOfficerApprovedAt, undefined);
  console.log(JSON.stringify({ selfTest: 'passed', networkRequests: 0, databaseWrites: 0 }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') { selfTest(); return; }
  const apply = args.includes('--apply');
  const envIndex = args.indexOf('--env-file');
  requireCondition(envIndex >= 0 && typeof args[envIndex + 1] === 'string' && args[envIndex + 1] && !args[envIndex + 1].startsWith('--'), 'EXPLICIT_ENV_FILE_REQUIRED');
  const allowed = new Set([envIndex, envIndex + 1, ...(apply ? [args.indexOf('--apply')] : [])]);
  requireCondition(args.every((_, i) => allowed.has(i)), 'UNKNOWN_ARGUMENT');
  process.loadEnvFile(args[envIndex + 1]);
  requireCondition(process.env.DATABASE_URL, 'LOCAL_DATABASE_CONFIGURATION_UNAVAILABLE');
  const db = new PrismaClient({ log: [] });
  try {
    const before = await db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return loadState(tx); }, { timeout: 20000 });
    const validated = validateState(before);
    if (validated.alreadyRecovered) {
      console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', outcome: 'already-recovered-no-changes', requestId: validated.requestId, pipelineId: validated.pipelineId, packageId: TARGET.packageId })); return;
    }
    const storage = await verifyStorage(validated.pkg);
    const ready = storage.active.matching === storage.active.total;
    const plan = {
      mode: apply ? 'apply' : 'dry-run', loanNumber: TARGET.loanNumber, ready,
      create: { completedProcessingRequests: 1, pipelineRows: 1, recoveryAudits: 1 },
      preserve: { loanId: TARGET.loanId, packageId: TARGET.packageId, packageRevision: validated.pkg.revision, documentHistoryCount: validated.pkg.history?.length || 0 },
      routing: { method: TARGET.processingMethod, group: TARGET.assignmentGroup, seniorProcessorId: TARGET.seniorId, juniorProcessorId: TARGET.ownerId },
      pipeline: { sheet: 'PIPELINE', status: 'PENDING_APPROVAL', financialAmounts: 'unset', fundedDates: 'unset', historicalMilestones: 'unavailable; initial defaults only' },
      oldRequestId: TARGET.oldRequestId, oldPipelineId: TARGET.oldPipelineId, routingAuditId: TARGET.originalAuditId,
      storageMetadata: storage, limitation: 'Metadata confirms stored size and type; file contents have not been downloaded or hashed. Original submission fields and task conversation are unavailable.',
      noAriveCalls: true, noNotifications: true, noPayrollChanges: true,
    };
    if (!apply) { console.log(JSON.stringify(plan)); return; }
    requireCondition(ready, 'ACTIVE_STORED_FILE_VERIFICATION_FAILED');
    const beforeHash = fingerprint(before);
    const outcome = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-test-pipeline-recovery:${TARGET.loanNumber}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pipeline-submission:${TARGET.loanId}:SUBMIT_PROCESSING`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${TARGET.packageId}`}))`;
      await tx.$queryRaw`SELECT id FROM "Loan" WHERE id = ${TARGET.loanId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${TARGET.packageId} FOR UPDATE`;
      const current = await loadState(tx);
      const check = validateState(current);
      if (check.alreadyRecovered) return { outcome: 'already-recovered-no-changes', requestId: check.requestId, pipelineId: check.pipelineId };
      requireCondition(fingerprint(current) === beforeHash, 'RECORDS_CHANGED_AFTER_STORAGE_VERIFICATION');
      const now = new Date();
      const data = recoveryData(current, now);
      const request = await tx.task.create({ data: data.task, select: { id: true } });
      const pipeline = await tx.processingPipelineLoan.create({ data: { ...data.pipeline, sourceTaskId: request.id }, select: { id: true } });
      await tx.auditLog.create({ data: {
        loanId: TARGET.loanId, userId: TARGET.ownerId, action: RECOVERY_ACTION,
        details: JSON.stringify({ recoveryVersion: 1, authorizedBy: 'Loan owner/Admin III request', method: 'one-off administrative reconstruction', oldRequestId: TARGET.oldRequestId, oldPipelineId: TARGET.oldPipelineId, originalRoutingAuditId: TARGET.originalAuditId, originalPipelineCreatedAt: current.originalAudit.createdAt.toISOString(), newRequestId: request.id, newPipelineId: pipeline.id, packageId: TARGET.packageId, preservedPackageRevision: check.pkg.revision, assignmentGroup: TARGET.assignmentGroup, processingMethod: TARGET.processingMethod, seniorProcessorId: TARGET.seniorId, juniorProcessorId: TARGET.ownerId, storageMetadata: storage, note: RECOVERY_NOTE }),
      } });
      const untouched = await tx.task.findUnique({ where: { id: TARGET.packageId }, select: { submissionData: true, updatedAt: true } });
      requireCondition(fingerprint(untouched?.submissionData) === fingerprint(check.packageTask.submissionData) && untouched.updatedAt.getTime() === check.packageTask.updatedAt.getTime(), 'PACKAGE_CHANGED_DURING_RECOVERY');
      return { outcome: 'recovered', requestId: request.id, pipelineId: pipeline.id };
    }, { timeout: 20000, maxWait: 10000, isolationLevel: 'Serializable' });
    console.log(JSON.stringify({ ...plan, ...outcome }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error(JSON.stringify({ outcome: 'stopped', reason: error instanceof RecoveryError ? error.message : 'RECOVERY_OPERATION_FAILED', category: error?.constructor?.name || 'Error' }));
  process.exitCode = 1;
});
