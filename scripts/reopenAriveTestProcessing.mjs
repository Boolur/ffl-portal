// One-time, explicitly authorized reopening of the recovered TESTING TESTER request.
// Dry run: node scripts/reopenAriveTestProcessing.mjs --env-file <local env path>
// Apply:   node scripts/reopenAriveTestProcessing.mjs --env-file <local env path> --apply
// Tests:   node scripts/reopenAriveTestProcessing.mjs --self-test
// No Arive calls, file transfers, notifications, loan updates, or pipeline updates.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const TARGET = Object.freeze({
  loanNumber: '17881588', loanId: 'e29decf7-02e7-4032-929f-348e0822868f', borrowerName: 'TESTING TESTER',
  ownerId: '2e28c6a5-67c0-442d-94bd-59897ad8d8cd', packageId: '9e1e3bf6-9aa0-4bc0-a254-7036ef4542c7',
  requestId: 'a21bf78b-821e-4d6a-bf2f-76200e2b0c10', pipelineId: '4f2cb065-4e77-4d21-9c6b-7cdd3004c122',
  oldRequestId: '022123b3-ad09-4592-b6b3-901ed6ed8fe1', oldPipelineId: '5775fac3-d362-49f5-bc13-c027d3e6dc0d',
});
const ACTION = 'ARIVE_TEST_PROCESSING_REOPENED';
const RECOVERY_ACTION = 'ARIVE_TEST_PIPELINE_RECOVERED';
const REQUEST_TITLE = 'Submit to Processing — recovered TESTING TESTER request';
const PACKAGE_TITLE = 'Processing submission pilot — documents';
const NOTE = 'Matt requested reopening TESTING TESTER for Jr Processor review. The request remains assigned to Matt and must be started before review. Existing document decisions, files, feedback, transfer records, and history are preserved. The loan, pipeline, and Arive records were not changed.';
class ReopenError extends Error {}
function requireCondition(condition, code) { if (!condition) throw new ReopenError(code); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function parseDetails(value) { try { return object(JSON.parse(value || '{}')); } catch { return {}; } }
function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function validateState(state) {
  const { loan, pipeline, owner, requests, packageTask, recoveryAudits, reopenAudits, openLoTasks } = state;
  requireCondition(loan?.id === TARGET.loanId && loan.loanNumber === TARGET.loanNumber && loan.loanOfficerId === TARGET.ownerId && loan.borrowerName.trim().toUpperCase() === TARGET.borrowerName, 'TARGET_LOAN_IDENTITY_MISMATCH');
  requireCondition(owner?.id === TARGET.ownerId && owner.active && [owner.role, ...owner.roles].some(role => role === 'ADMIN_III' || role === 'ADMIN'), 'AUTHORIZED_OWNER_UNAVAILABLE');
  requireCondition(pipeline?.id === TARGET.pipelineId && pipeline.loanId === TARGET.loanId && pipeline.sourceTaskId === TARGET.requestId, 'RECOVERED_PIPELINE_IDENTITY_MISMATCH');
  requireCondition(requests.length === 1, 'AMBIGUOUS_PROCESSING_REQUESTS');
  const request = requests[0];
  requireCondition(request.id === TARGET.requestId && request.loanId === TARGET.loanId && request.kind === 'SUBMIT_PROCESSING' && request.title === REQUEST_TITLE && object(request.submissionData).processingDocumentTaskId === TARGET.packageId, 'RECOVERED_REQUEST_IDENTITY_MISMATCH');
  requireCondition(packageTask?.id === TARGET.packageId && packageTask.loanId === TARGET.loanId && packageTask.kind === null && packageTask.title === PACKAGE_TITLE && packageTask.parentTaskId === null, 'PACKAGE_IDENTITY_MISMATCH');
  const pkg = object(packageTask.submissionData).submissionPilot;
  requireCondition(pkg?.version === 1 && Number.isInteger(pkg.revision) && pkg.revision >= 31 && Array.isArray(pkg.items) && Array.isArray(pkg.history), 'PACKAGE_FORMAT_CHANGED');
  requireCondition(recoveryAudits.length === 1, 'RECOVERY_AUDIT_UNAVAILABLE_OR_AMBIGUOUS');
  const recovery = parseDetails(recoveryAudits[0].details);
  requireCondition(recovery.recoveryVersion === 1 && recovery.oldRequestId === TARGET.oldRequestId && recovery.oldPipelineId === TARGET.oldPipelineId && recovery.newRequestId === TARGET.requestId && recovery.newPipelineId === TARGET.pipelineId && recovery.packageId === TARGET.packageId, 'RECOVERY_AUDIT_IDENTITY_MISMATCH');
  requireCondition(reopenAudits.length <= 1, 'AMBIGUOUS_REOPEN_AUDITS');
  if (reopenAudits.length) {
    const prior = parseDetails(reopenAudits[0].details);
    requireCondition(prior.reopenVersion === 1 && prior.requestId === TARGET.requestId && prior.pipelineId === TARGET.pipelineId && prior.packageId === TARGET.packageId && prior.ownerId === TARGET.ownerId, 'REOPEN_AUDIT_IDENTITY_MISMATCH');
    // A later completed request must never be reopened again by replaying this script.
    return { alreadyReopened: true, request, packageTask, pkg };
  }
  requireCondition(!pipeline.archivedAt, 'PIPELINE_ARCHIVED');
  requireCondition(request.status === 'COMPLETED' && request.workflowState === 'NONE' && request.completedAt && request.assignedUserId === TARGET.ownerId && request.assignedRole === 'PROCESSOR_JR', 'REQUEST_NO_LONGER_COMPLETED_BY_MATT');
  requireCondition(openLoTasks.length === 0, 'OPEN_LO_RESPONSE_EXISTS');
  requireCondition(packageTask.status === 'COMPLETED' && packageTask.completedAt && pkg.state === 'APPROVED' && pkg.reviewerId === TARGET.ownerId, 'PACKAGE_NO_LONGER_APPROVED_BY_MATT');
  requireCondition(pkg.items.length > 0 && pkg.items.every(item => item.review === 'APPROVED' && Array.isArray(item.files) && (item.files.length > 0 || typeof item.waiver === 'string' && item.waiver.trim()) && !item.pending), 'DOCUMENT_REVIEW_CHANGED');
  requireCondition(!Object.values(object(pkg.ariveTransfers)).some(transfer => transfer?.state === 'SENDING'), 'DOCUMENT_TRANSFER_IN_PROGRESS');
  return { alreadyReopened: false, request, packageTask, pkg };
}

function reopenData(state, now) {
  const checked = validateState(state);
  requireCondition(!checked.alreadyReopened, 'ALREADY_REOPENED');
  const { request, packageTask, pkg } = checked;
  const author = state.owner.name || 'Matt Mahjoub';
  const prior = object(request.submissionData);
  const lifecycleHistory = Array.isArray(prior.lifecycleHistory) ? prior.lifecycleHistory : [];
  const notesHistory = Array.isArray(prior.notesHistory) ? prior.notesHistory : [];
  const nextPackage = { ...structuredClone(pkg), state: 'REVIEW', reviewerId: null, revision: pkg.revision + 1,
    history: [...structuredClone(pkg.history), { at: now.toISOString(), actor: author, message: NOTE }] };
  return {
    request: { status: 'PENDING', workflowState: 'NONE', completedAt: null,
      submissionData: { ...structuredClone(prior),
        notesHistory: [...structuredClone(notesHistory), { author, role: 'ADMIN_III', message: NOTE, date: now.toISOString(), entryType: 'status' }],
        lifecycleHistory: [...structuredClone(lifecycleHistory), { id: randomUUID(), at: now.toISOString(), actorName: author, actorRole: 'ADMIN_III', eventType: 'REOPENED', fromStatus: request.status, toStatus: 'PENDING', fromWorkflow: request.workflowState, toWorkflow: 'NONE', fromAssignedUserId: request.assignedUserId, toAssignedUserId: request.assignedUserId, fromAssignedRole: request.assignedRole, toAssignedRole: request.assignedRole, note: NOTE }],
      },
    },
    packageTask: { status: 'PENDING', workflowState: 'NONE', assignedRole: 'PROCESSOR_JR', assignedUserId: TARGET.ownerId, completedAt: null,
      submissionData: { ...structuredClone(object(packageTask.submissionData)), submissionPilot: nextPackage },
    },
  };
}

async function loadState(tx) {
  const loan = await tx.loan.findUnique({ where: { id: TARGET.loanId }, select: { id: true, loanNumber: true, loanOfficerId: true, borrowerName: true, stage: true, updatedAt: true } });
  const pipeline = await tx.processingPipelineLoan.findUnique({ where: { id: TARGET.pipelineId } });
  const owner = await tx.user.findUnique({ where: { id: TARGET.ownerId }, select: { id: true, name: true, active: true, role: true, roles: true } });
  const requests = await tx.task.findMany({ where: { loanId: TARGET.loanId, kind: 'SUBMIT_PROCESSING' }, orderBy: { id: 'asc' } });
  const packageTask = await tx.task.findUnique({ where: { id: TARGET.packageId } });
  const recoveryAudits = await tx.auditLog.findMany({ where: { loanId: TARGET.loanId, action: RECOVERY_ACTION }, select: { id: true, details: true } });
  const reopenAudits = await tx.auditLog.findMany({ where: { loanId: TARGET.loanId, action: ACTION }, select: { id: true, details: true } });
  const openLoTasks = await tx.task.findMany({ where: { parentTaskId: TARGET.requestId, kind: 'LO_NEEDS_INFO', status: { not: 'COMPLETED' } }, select: { id: true } });
  return { loan, pipeline, owner, requests, packageTask, recoveryAudits, reopenAudits, openLoTasks };
}

function selfTest() {
  const completedAt = new Date('2026-11-06T00:00:00Z');
  const pkg = { version: 1, revision: 40, state: 'APPROVED', reviewerId: TARGET.ownerId,
    items: [{ id: 'mortgage', review: 'APPROVED', files: [{ id: 'f1', name: 'fixture.pdf', path: 'fixture/path' }], feedback: 'Original feedback', waiver: '' }],
    retiredFiles: [{ id: 'old' }], ariveLink: { id: 'arive-fixture', loanNumber: TARGET.loanNumber }, ariveTransfers: { f1: { state: 'SENT', documentId: 123 } }, ariveNotes: { notes: [{ text: 'Preserved' }] },
    history: [{ actor: 'Synthetic reviewer', message: 'Approved', at: completedAt.toISOString() }] };
  const state = {
    loan: { id: TARGET.loanId, loanNumber: TARGET.loanNumber, loanOfficerId: TARGET.ownerId, borrowerName: TARGET.borrowerName, stage: 'PROCESSING' },
    pipeline: { id: TARGET.pipelineId, loanId: TARGET.loanId, sourceTaskId: TARGET.requestId, archivedAt: null, lender: 'Keep lender', projectedRevenue: '1234', dateAssigned: completedAt },
    owner: { id: TARGET.ownerId, name: 'Synthetic reviewer', active: true, role: 'ADMIN_III', roles: ['PROCESSOR_JR'] },
    requests: [{ id: TARGET.requestId, loanId: TARGET.loanId, kind: 'SUBMIT_PROCESSING', title: REQUEST_TITLE, status: 'COMPLETED', workflowState: 'NONE', completedAt, assignedUserId: TARGET.ownerId, assignedRole: 'PROCESSOR_JR', submissionData: { processingDocumentTaskId: TARGET.packageId, other: 'Keep me', notesHistory: [{ message: 'Old note' }], lifecycleHistory: [{ eventType: 'COMPLETED' }] } }],
    packageTask: { id: TARGET.packageId, loanId: TARGET.loanId, kind: null, title: PACKAGE_TITLE, parentTaskId: null, status: 'COMPLETED', completedAt, submissionData: { other: 'Keep package metadata', submissionPilot: pkg } },
    recoveryAudits: [{ details: JSON.stringify({ recoveryVersion: 1, oldRequestId: TARGET.oldRequestId, oldPipelineId: TARGET.oldPipelineId, newRequestId: TARGET.requestId, newPipelineId: TARGET.pipelineId, packageId: TARGET.packageId }) }], reopenAudits: [], openLoTasks: [],
  };
  const original = fingerprint(state);
  const data = reopenData(state, new Date('2026-11-07T00:00:00Z'));
  assert.equal(fingerprint(state), original);
  assert.equal(data.request.status, 'PENDING'); assert.equal(data.request.workflowState, 'NONE'); assert.equal(data.request.completedAt, null);
  assert.equal(data.request.assignedUserId, undefined); // Preserve the request's current Matt assignment.
  assert.equal(data.request.submissionData.other, 'Keep me');
  assert.deepEqual(data.request.submissionData.notesHistory.slice(0, -1), state.requests[0].submissionData.notesHistory);
  assert.deepEqual(data.request.submissionData.lifecycleHistory.slice(0, -1), state.requests[0].submissionData.lifecycleHistory);
  assert.equal(data.packageTask.status, 'PENDING'); assert.equal(data.packageTask.completedAt, null);
  const next = data.packageTask.submissionData.submissionPilot;
  assert.equal(next.state, 'REVIEW'); assert.equal(next.reviewerId, null); assert.equal(next.revision, 41);
  for (const key of ['items', 'retiredFiles', 'ariveLink', 'ariveTransfers', 'ariveNotes']) assert.deepEqual(next[key], pkg[key]);
  assert.deepEqual(next.history.slice(0, -1), pkg.history);
  assert.equal(data.packageTask.submissionData.other, 'Keep package metadata');
  assert.deepEqual(Object.keys(data).sort(), ['packageTask', 'request']);
  for (const change of [
    s => { s.loan.loanNumber = '999'; }, s => { s.loan.loanOfficerId = 'other'; }, s => { s.loan.borrowerName = 'Other'; },
    s => { s.owner.active = false; }, s => { s.pipeline.sourceTaskId = 'other'; }, s => { s.pipeline.archivedAt = completedAt; },
    s => { s.requests.push({ ...s.requests[0], id: 'another' }); }, s => { s.requests[0].assignedUserId = 'another'; },
    s => { s.requests[0].status = 'PENDING'; }, s => { s.requests[0].submissionData.processingDocumentTaskId = 'other'; },
    s => { s.packageTask.loanId = 'other'; }, s => { s.packageTask.submissionData.submissionPilot.state = 'REVIEW'; },
    s => { s.packageTask.submissionData.submissionPilot.items[0].pending = {}; }, s => { s.packageTask.submissionData.submissionPilot.ariveTransfers.f1.state = 'SENDING'; },
    s => { s.openLoTasks.push({ id: 'child' }); }, s => { s.recoveryAudits[0].details = '{}'; },
  ]) { const changed = structuredClone(state); change(changed); assert.throws(() => validateState(changed), ReopenError); }
  const replay = structuredClone(state);
  replay.reopenAudits.push({ details: JSON.stringify({ reopenVersion: 1, requestId: TARGET.requestId, pipelineId: TARGET.pipelineId, packageId: TARGET.packageId, ownerId: TARGET.ownerId }) });
  assert.equal(validateState(replay).alreadyReopened, true); // Even if it was completed again later.
  replay.requests[0].status = 'PENDING'; replay.packageTask.submissionData.submissionPilot.state = 'CHANGES';
  assert.equal(validateState(replay).alreadyReopened, true);
  assert.throws(() => reopenData(replay, completedAt), ReopenError);
  replay.reopenAudits[0].details = '{}'; assert.throws(() => validateState(replay), ReopenError);
  console.log(JSON.stringify({ selfTest: 'passed', networkRequests: 0, databaseWrites: 0 }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') { selfTest(); return; }
  const apply = args.includes('--apply');
  const envIndex = args.indexOf('--env-file');
  requireCondition(envIndex >= 0 && args[envIndex + 1] && !args[envIndex + 1].startsWith('--'), 'EXPLICIT_ENV_FILE_REQUIRED');
  const allowed = new Set([envIndex, envIndex + 1, ...(apply ? [args.indexOf('--apply')] : [])]);
  requireCondition(args.every((_, index) => allowed.has(index)), 'UNKNOWN_ARGUMENT');
  process.loadEnvFile(args[envIndex + 1]);
  requireCondition(process.env.DATABASE_URL, 'LOCAL_DATABASE_CONFIGURATION_UNAVAILABLE');
  const db = new PrismaClient({ log: [] });
  try {
    const before = await db.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return loadState(tx); }, { timeout: 20000 });
    const checked = validateState(before);
    if (checked.alreadyReopened) { console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', outcome: 'already-reopened-no-changes', requestId: TARGET.requestId })); return; }
    const plan = { mode: apply ? 'apply' : 'dry-run', loanNumber: TARGET.loanNumber, requestId: TARGET.requestId, packageId: TARGET.packageId,
      request: { from: 'COMPLETED', to: 'PENDING', workflow: 'NONE', assignedUserId: TARGET.ownerId, startRequired: true, bucket: 'My Started Processing Requests' },
      package: { from: 'APPROVED', to: 'REVIEW', fromRevision: checked.pkg.revision, toRevision: checked.pkg.revision + 1, approvedCategoriesPreserved: checked.pkg.items.length, fileCountPreserved: checked.pkg.items.reduce((count, item) => count + item.files.length, 0) },
      noLoanChanges: true, noPipelineChanges: true, noAriveCalls: true, noNotifications: true,
    };
    if (!apply) { console.log(JSON.stringify({ ...plan, outcome: 'ready' })); return; }
    const beforeHash = fingerprint(before);
    const outcome = await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pipeline-submission:${TARGET.loanId}:SUBMIT_PROCESSING`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-pilot:${TARGET.packageId}`}))`;
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id IN (${TARGET.requestId}, ${TARGET.packageId}) ORDER BY id FOR UPDATE`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`arive-pipeline:${TARGET.pipelineId}`}))`;
      const current = await loadState(tx);
      const fresh = validateState(current);
      if (fresh.alreadyReopened) return 'already-reopened-no-changes';
      requireCondition(fingerprint(current) === beforeHash, 'RECORDS_CHANGED_AFTER_PRECHECK');
      const now = new Date();
      const changes = reopenData(current, now);
      const requestWrite = await tx.task.updateMany({ where: { id: TARGET.requestId, updatedAt: fresh.request.updatedAt, status: 'COMPLETED', workflowState: 'NONE', assignedUserId: TARGET.ownerId }, data: changes.request });
      const packageWrite = await tx.task.updateMany({ where: { id: TARGET.packageId, updatedAt: fresh.packageTask.updatedAt, status: 'COMPLETED' }, data: changes.packageTask });
      requireCondition(requestWrite.count === 1 && packageWrite.count === 1, 'RECORDS_CHANGED_DURING_REOPEN');
      await tx.auditLog.create({ data: { loanId: TARGET.loanId, userId: TARGET.ownerId, action: ACTION, details: JSON.stringify({
        reopenVersion: 1, requestId: TARGET.requestId, pipelineId: TARGET.pipelineId, packageId: TARGET.packageId, ownerId: TARGET.ownerId,
        authorizedBy: 'Matt explicitly requested reopening the test submission for Jr review', note: NOTE,
        previousPackageRevision: fresh.pkg.revision, nextPackageRevision: fresh.pkg.revision + 1,
        originalRequest: fresh.request, originalPackageTask: fresh.packageTask,
        preservedLoanFingerprint: fingerprint(current.loan), preservedPipelineFingerprint: fingerprint(current.pipeline),
      }) } });
      const after = await loadState(tx);
      requireCondition(fingerprint(after.loan) === fingerprint(current.loan) && fingerprint(after.pipeline) === fingerprint(current.pipeline), 'LOAN_OR_PIPELINE_CHANGED_DURING_REOPEN');
      requireCondition(validateState(after).alreadyReopened, 'REOPEN_AUDIT_VERIFICATION_FAILED');
      return 'reopened-awaiting-start';
    }, { timeout: 20000, maxWait: 10000, isolationLevel: 'Serializable' });
    console.log(JSON.stringify({ ...plan, outcome }));
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error(JSON.stringify({ outcome: 'stopped', reason: error instanceof ReopenError ? error.message : 'REOPEN_OPERATION_FAILED', category: error?.constructor?.name || 'Error' }));
  process.exitCode = 1;
});
