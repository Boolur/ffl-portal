import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';
import { practiceInitialItems } from '../../lib/pilotPractice';

const m = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), preference: vi.fn(), task: vi.fn(), loan: vi.fn(), pipeline: vi.fn(), attachment: vi.fn(), attachments: vi.fn(),
  practice: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), packageUpdate: vi.fn(), fileCreate: vi.fn(), fileUpdate: vi.fn(), events: vi.fn(), eventCreate: vi.fn(), notifications: vi.fn(), notificationCreate: vi.fn(), transaction: vi.fn(),
  bucket: vi.fn(), upload: vi.fn(), info: vi.fn(), sign: vi.fn(), productionMutation: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: m.user, update: m.preference },
  task: { findUnique: m.task, update: m.productionMutation, updateMany: m.productionMutation },
  loan: { findUnique: m.loan, update: m.productionMutation },
  processingPipelineLoan: { findFirst: m.pipeline, update: m.productionMutation },
  taskAttachment: { findUnique: m.attachment, findMany: m.attachments, create: m.productionMutation },
  notification: { create: m.productionMutation, createMany: m.productionMutation },
  pilotPracticeTask: { findUnique: m.practice, findMany: m.list, create: m.create, updateMany: m.update },
  pilotPracticePackage: { update: m.packageUpdate }, pilotPracticeFile: { create: m.fileCreate, update: m.fileUpdate },
  pilotPracticeEvent: { findMany: m.events, create: m.eventCreate }, pilotPracticeNotification: { findMany: m.notifications, create: m.notificationCreate },
  $transaction: m.transaction,
} }));
vi.mock('@/lib/pilotPracticeAccess', async () => import('../../lib/pilotPracticeAccess'));
vi.mock('@/lib/pilotPractice', async () => import('../../lib/pilotPractice'));
vi.mock('@/lib/pilotPracticeDocuments', async () => import('../../lib/pilotPracticeDocuments'));
vi.mock('@/lib/pilotPracticeFileAccess', async () => import('../../lib/pilotPracticeFileAccess'));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
vi.mock('@/lib/processingBorrowerDetails', async () => import('../../lib/processingBorrowerDetails'));
vi.mock('@/lib/storedUploadVerification', async () => import('../../lib/storedUploadVerification'));
vi.mock('@/lib/supabaseAdmin', () => ({ getTaskAttachmentsBucket: () => 'attachments', getSupabaseAdmin: () => ({ storage: { getBucket: m.bucket, from: () => ({ createSignedUploadUrl: m.upload, info: m.info, createSignedUrl: m.sign }) } }) }));
// The server file helper imports this dependency relatively.
vi.mock('../../lib/supabaseAdmin', () => ({ getTaskAttachmentsBucket: () => 'attachments', getSupabaseAdmin: () => ({ storage: { getBucket: m.bucket, from: () => ({ createSignedUploadUrl: m.upload, info: m.info, createSignedUrl: m.sign }) } }) }));

import { prisma } from '@/lib/prisma';
import { getPilotPreferences, setPilotViewEnabled } from './pilotPreferenceActions';
import { changePracticeTask, createPracticeTask, getPracticeTask, listPracticeTasks, savePracticeSubmission } from './practiceTaskActions';
import { finalizePracticeUpload, getPracticeFileAccess, preparePracticeDocumentDownload, preparePracticeUpload, validatePracticeDocumentDownload } from './practiceDocumentActions';

function user(role: UserRole = UserRole.LOAN_OFFICER) {
  return { id: SUBMISSION_PILOT_LO_ID, active: true, name: 'Matt', role, roles: [role], processingAssignmentGroups: [], pilotViewEnabled: false };
}
function sourceTask() {
  return { id: 'live-task', loanId: 'live-loan', kind: 'SUBMIT_PROCESSING', status: 'IN_PROGRESS', workflowState: 'NONE', updatedAt: new Date('2026-11-12T12:00:00Z'), title: 'Live submission', assignedUserId: null, assignedRole: 'PROCESSOR_JR', submissionData: { lender: 'Test lender', cardNumber: 'REDACT', processingDocumentTaskId: null, token: 'REDACT', files: ['secret path'] }, loan: { id: 'live-loan', borrowerName: 'Test borrower', loanNumber: '123', loanOfficerId: SUBMISSION_PILOT_LO_ID, secondaryLoanOfficerId: null, visibilitySubmitterUserId: null } };
}
function practiceTask() {
  return { id: 'practice-task', ownerId: SUBMISSION_PILOT_LO_ID, sourceTaskId: 'live-task', sourceLoanId: 'live-loan', title: 'Practice', kind: 'SUBMIT_PROCESSING', state: 'DRAFT', version: 0, snapshot: {}, draft: {}, createdAt: new Date(), updatedAt: new Date(), package: { id: 'package', items: practiceInitialItems(), files: [{ id: '00000000-0000-0000-0000-000000000001', itemId: 'mortgage', name: 'Statement.pdf', size: 10, type: 'application/pdf', uploaded: true, retired: false, path: `pilot-practice/${SUBMISSION_PILOT_LO_ID}/practice-task/00000000-0000-0000-0000-000000000001.pdf`, sourceAttachmentId: null, sourceDocumentTaskId: null, sourceDocumentFileId: null }] } };
}
let current: ReturnType<typeof practiceTask>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PILOT_VIEW_ENABLED', 'true'); vi.stubEnv('PILOT_PRACTICE_ENABLED', 'true'); vi.stubEnv('SUPABASE_STORAGE_BUCKET_PRACTICE_ATTACHMENTS', '');
  m.session.mockResolvedValue({ user: { id: SUBMISSION_PILOT_LO_ID, role: 'LOAN_OFFICER', activeRole: 'LOAN_OFFICER' } });
  m.user.mockResolvedValue(user()); m.task.mockResolvedValue(sourceTask());
  current = practiceTask(); m.practice.mockImplementation(async () => current);
  m.list.mockResolvedValue([current]); m.events.mockResolvedValue([]); m.notifications.mockResolvedValue([]); m.attachments.mockResolvedValue([]);
  m.transaction.mockImplementation(async work => work(prisma)); m.update.mockResolvedValue({ count: 1 });
  m.bucket.mockResolvedValue({ data: { public: false }, error: null }); m.upload.mockResolvedValue({ data: { signedUrl: 'https://storage.test/upload', token: 'upload-token' }, error: null });
  m.info.mockResolvedValue({ data: { size: 10, contentType: 'application/pdf' }, error: null }); m.sign.mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null });
  m.create.mockResolvedValue(current);
});
afterEach(() => { expect(m.productionMutation).not.toHaveBeenCalled(); vi.unstubAllEnvs(); });

describe('pilot preference and fresh authorization', () => {
  it('is disabled by default, allows opting out while off, and never treats a preference as authority', async () => {
    vi.stubEnv('PILOT_VIEW_ENABLED', '');
    m.user.mockResolvedValue({ ...user(), pilotViewEnabled: true });
    expect(await getPilotPreferences()).toMatchObject({ success: true, data: { available: false, enabled: false } });
    expect(await setPilotViewEnabled(true)).toMatchObject({ success: false });
    expect(m.preference).not.toHaveBeenCalled();
    expect(await setPilotViewEnabled(false)).toMatchObject({ success: true, data: { enabled: false } });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
    expect(m.practice).not.toHaveBeenCalled();
  });
  it('requires both feature gates for practice', async () => {
    vi.stubEnv('PILOT_PRACTICE_ENABLED', 'false');
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false }); expect(m.practice).not.toHaveBeenCalled();
  });
  it.each(['signed-out', 'inactive', 'other-LO', 'forged-role'] as const)('denies %s before source, practice or storage access', async kind => {
    if (kind === 'signed-out') m.session.mockResolvedValue(null);
    if (kind === 'inactive') m.user.mockResolvedValue({ ...user(), active: false });
    if (kind === 'other-LO') m.user.mockResolvedValue({ ...user(), id: 'other' });
    if (kind === 'forged-role') m.session.mockResolvedValue({ user: { id: SUBMISSION_PILOT_LO_ID, activeRole: 'ADMIN_III' } });
    expect(await getPracticeFileAccess(current.id, current.package.files[0].id)).toMatchObject({ success: false });
    expect(m.practice).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it.each([UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III])('permits eligible %s access without impersonation', async role => {
    m.user.mockResolvedValue({ ...user(role), id: 'admin' }); m.session.mockResolvedValue({ user: { id: 'admin', activeRole: role } });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: true });
  });
  it('does not let an admin membership bypass loan scope while their active role is LO', async () => {
    m.user.mockResolvedValue({ ...user(), id: 'admin', roles: ['LOAN_OFFICER', 'ADMIN_III'] });
    m.session.mockResolvedValue({ user: { id: 'admin', activeRole: 'LOAN_OFFICER' } });
    current.ownerId = 'admin';
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
  });
  it('reauthorizes changed source ownership for reads, mutations and file access', async () => {
    m.task.mockResolvedValue({ ...sourceTask(), loan: { ...sourceTask().loan, loanOfficerId: 'another-owner' } });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'LO', action: 'NOTE', text: 'Test' })).toMatchObject({ success: false });
    expect(await getPracticeFileAccess(current.id, current.package.files[0].id)).toMatchObject({ success: false });
    expect(await listPracticeTasks()).toEqual({ success: true, data: [] });
    expect(m.update).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it('rejects a source task/loan mismatch and another user’s synthetic copy', async () => {
    current.sourceLoanId = 'wrong-loan'; expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
    Object.assign(current, { sourceTaskId: null, sourceLoanId: null, ownerId: 'other' });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
  });
  it('does not let a retained task assignment bypass the selected role', async () => {
    m.user.mockResolvedValue({ ...user(), roles: ['LOAN_OFFICER', 'PROCESSOR_JR', 'QC'] });
    m.session.mockResolvedValue({ user: { id: SUBMISSION_PILOT_LO_ID, activeRole: 'QC' } });
    m.task.mockResolvedValue({ ...sourceTask(), assignedUserId: SUBMISSION_PILOT_LO_ID });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: false });
    m.session.mockResolvedValue({ user: { id: SUBMISSION_PILOT_LO_ID, activeRole: 'PROCESSOR_JR' } });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: true });
  });
});

describe('practice mutations stay isolated', () => {
  it('saves a simulated draft with version checking while leaving source and snapshot immutable', async () => {
    const input = { id: current.id, version: 0, persona: 'LO' as const, draft: { borrowerFirstName: 'Practice', notesGoals: 'Example' } };
    expect(await savePracticeSubmission(input)).toEqual({ success: true, data: { id: current.id, version: 1 } });
    expect(m.update.mock.calls[0][0].data).toEqual({ draft: input.draft, version: { increment: 1 } });
    current.state = 'STARTED'; m.update.mockClear();
    expect(await savePracticeSubmission(input)).toMatchObject({ success: false }); expect(m.update).not.toHaveBeenCalled();
    current.state = 'DRAFT';
    expect(await savePracticeSubmission({ ...input, draft: { loanOfficerId: 'other' } })).toMatchObject({ success: false });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('copies permitted context and references, but not live IDs, secrets or completion decisions into writable task data', async () => {
    expect(await createPracticeTask({ sourceTaskId: 'live-task' })).toMatchObject({ success: true });
    const data = m.create.mock.calls[0][0].data;
    expect(data.sourceTaskId).toBe('live-task'); expect(data.snapshot.submissionDetails).toEqual({ lender: 'Test lender' });
    expect(data.snapshot.sourceUpdatedAt).toBe('2026-11-12T12:00:00.000Z');
    expect(data.package.create.items.every((item: { review: string }) => item.review === 'PENDING')).toBe(true);
    expect(data.status).toBeUndefined(); expect(m.notificationCreate).not.toHaveBeenCalled();
  });
  it('keeps the captured context immutable when the original task subsequently changes', async () => {
    current.snapshot = { borrowerName: 'Captured borrower', sourceUpdatedAt: '2026-11-11T12:00:00.000Z' };
    m.task.mockResolvedValue({ ...sourceTask(), title: 'Changed title', loan: { ...sourceTask().loan, borrowerName: 'Changed borrower' } });
    expect(await getPracticeTask(current.id)).toMatchObject({ success: true, data: { snapshot: current.snapshot, title: 'Practice' } });
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'LO', action: 'NOTE', text: 'Practice note' })).toMatchObject({ success: true });
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty('snapshot');
  });
  it('captures actual loan context, source timestamp and pipeline version only through current row scope', async () => {
    m.loan.mockResolvedValue({ ...sourceTask().loan, updatedAt: new Date('2026-11-10T12:00:00Z'), amount: { toString: () => '250000' }, program: 'Conventional', propertyAddress: '100 Sample Street' });
    m.pipeline.mockResolvedValue({ id: 'pipeline', version: 7, updatedAt: new Date('2026-11-12T12:00:00Z'), lender: 'Example lender', pipelineStatus: 'SUBBED_TO_UW', sheet: 'PIPELINE' });
    expect(await createPracticeTask({ sourceLoanId: 'live-loan' })).toMatchObject({ success: true });
    expect(m.create.mock.calls[0][0].data.snapshot).toMatchObject({ sourceLoanUpdatedAt: '2026-11-10T12:00:00.000Z', sourcePipelineId: 'pipeline', sourcePipelineVersion: 7, loan: { amount: '250000', program: 'Conventional', propertyAddress: '100 Sample Street' }, pipeline: { lender: 'Example lender' } });
    expect(m.pipeline.mock.calls[0][0].where).toHaveProperty('AND');
    m.pipeline.mockResolvedValue(null); m.create.mockClear();
    expect(await createPracticeTask({ sourceLoanId: 'live-loan' })).toMatchObject({ success: false }); expect(m.create).not.toHaveBeenCalled();
  });
  it('copies every supported source attachment as a read-only reference without its storage path', async () => {
    m.attachments.mockResolvedValue(['one', 'two'].map(id => ({ id, taskId: 'live-task', filename: 'Statement.pdf', contentType: 'application/pdf', sizeBytes: 10, storagePath: `tasks/live-task/${id}.pdf` })));
    expect(await createPracticeTask({ sourceTaskId: 'live-task' })).toMatchObject({ success: true });
    const files = m.create.mock.calls[0][0].data.package.create.files.create;
    expect(files.map((file: { sourceAttachmentId: string }) => file.sourceAttachmentId)).toEqual(['one', 'two']);
    expect(files.every((file: { path?: string }) => file.path === undefined)).toBe(true);
  });
  it('blocks stale revisions before any mutation', async () => {
    expect(await changePracticeTask({ id: current.id, version: 7, persona: 'LO', action: 'NOTE', text: 'Note' })).toMatchObject({ success: false, error: expect.stringContaining('changed') });
    expect(m.update).not.toHaveBeenCalled();
  });
  it('enforces Start and records only practice events and simulated notifications', async () => {
    current.state = 'REVIEW';
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'JR', action: 'REVIEW', itemId: 'mortgage', approved: true })).toMatchObject({ success: false });
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'JR', action: 'START' })).toMatchObject({ success: true, data: { state: 'STARTED', version: 1 } });
    expect(m.eventCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ taskId: current.id, action: 'START' }) });
    current.state = 'STARTED';
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'JR', action: 'REJECT', text: 'Wrong documents' })).toMatchObject({ success: true });
    expect(m.notificationCreate).toHaveBeenCalledWith({ data: { taskId: current.id, persona: 'LO', message: 'Wrong documents' } });
  });
  it('detects an optimistic update lost to another request', async () => {
    m.update.mockResolvedValue({ count: 0 });
    expect(await changePracticeTask({ id: current.id, version: 0, persona: 'LO', action: 'NOTE', text: 'Note' })).toMatchObject({ success: false });
    expect(m.eventCreate).not.toHaveBeenCalled(); expect(m.packageUpdate).not.toHaveBeenCalled();
  });
});

describe('practice storage and approved downloads', () => {
  const upload = () => preparePracticeUpload({ id: 'practice-task', version: 0, itemId: 'mortgage', name: 'New.pdf', type: 'application/pdf', size: 10 });
  it('uses only a generated private practice prefix and rejects a public bucket', async () => {
    expect(await upload()).toMatchObject({ success: true, data: { version: 1 } });
    expect(m.upload.mock.calls[0][0]).toMatch(new RegExp(`^pilot-practice/${SUBMISSION_PILOT_LO_ID}/practice-task/[a-f0-9-]+\\.pdf$`));
    m.bucket.mockResolvedValue({ data: { public: true }, error: null }); m.upload.mockClear();
    expect(await upload()).toMatchObject({ success: false }); expect(m.upload).not.toHaveBeenCalled();
  });
  it.each([{ data: { size: 10, contentType: 'application/pdf' }, error: null }, { data: { metadata: { size: 10, mimetype: 'application/pdf' } }, error: null }])('verifies current and older storage metadata before completing an upload', async response => {
    current.package.files[0].uploaded = false; m.info.mockResolvedValue(response);
    expect(await finalizePracticeUpload({ id: current.id, version: 0, fileId: current.package.files[0].id })).toMatchObject({ success: true });
    expect(m.fileUpdate).toHaveBeenCalledWith({ where: { id: current.package.files[0].id }, data: { uploaded: true } });
  });
  it.each([{ data: { size: 11, contentType: 'application/pdf' }, error: null }, { data: { size: 10, contentType: 'text/html' }, error: null }, { data: null, error: { status: 404 } }, { data: null, error: { status: 500 } }])('does not finalize an invalid or unavailable upload', async response => {
    current.package.files[0].uploaded = false; m.info.mockResolvedValue(response);
    expect(await finalizePracticeUpload({ id: current.id, version: 0, fileId: current.package.files[0].id })).toMatchObject({ success: false });
    expect(m.fileUpdate).not.toHaveBeenCalled();
  });
  it('does not serve arbitrary paths or retired files', async () => {
    current.package.files[0].path = 'tasks/live-task/private.pdf';
    expect(await getPracticeFileAccess(current.id, current.package.files[0].id)).toMatchObject({ success: false });
    current = practiceTask(); current.package.files[0].retired = true;
    expect(await getPracticeFileAccess(current.id, current.package.files[0].id)).toMatchObject({ success: false });
    expect(m.sign).not.toHaveBeenCalled();
  });
  it('reauthorizes and resolves source attachments at delivery, rejecting removal, replacement and reassignment', async () => {
    const file = current.package.files[0];
    Object.assign(file, { path: null, sourceAttachmentId: 'source-file' });
    const source = { id: 'source-file', taskId: 'live-task', filename: file.name, contentType: file.type, sizeBytes: file.size, storagePath: 'tasks/live-task/original.pdf' };
    m.attachment.mockResolvedValue(source);
    expect(await getPracticeFileAccess(current.id, file.id)).toMatchObject({ success: true });
    expect(m.sign).toHaveBeenCalledWith('tasks/live-task/original.pdf', 300);
    for (const changed of [null, { ...source, filename: 'Replaced.pdf' }, { ...source, taskId: 'other-task' }, { ...source, storagePath: 'tasks/live-task/../other/file.pdf' }]) {
      m.sign.mockClear(); m.attachment.mockResolvedValue(changed);
      expect(await getPracticeFileAccess(current.id, file.id)).toMatchObject({ success: false }); expect(m.sign).not.toHaveBeenCalled();
    }
  });
  it('does not reuse a removed original package file or a package link to another loan', async () => {
    const file = current.package.files[0];
    Object.assign(file, { path: null, sourceDocumentTaskId: 'source-package', sourceDocumentFileId: 'original-file' });
    const originalFile = { id: 'original-file', name: file.name, type: file.type, size: file.size, path: `processing-submission/${SUBMISSION_PILOT_LO_ID}/00000000-0000-0000-0000-000000000002.pdf` };
    const document = { id: 'source-package', loanId: 'live-loan', loan: { loanOfficerId: SUBMISSION_PILOT_LO_ID }, submissionData: { submissionPilot: { version: 1, items: [{ id: 'mortgage', files: [originalFile] }] } } };
    m.task.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'source-package' ? document : { ...sourceTask(), submissionData: { processingDocumentTaskId: 'source-package' } });
    expect(await getPracticeFileAccess(current.id, file.id)).toMatchObject({ success: true });
    document.submissionData.submissionPilot.items[0].files = [];
    expect(await getPracticeFileAccess(current.id, file.id)).toMatchObject({ success: false });
    document.submissionData.submissionPilot.items[0].files = [originalFile]; document.loanId = 'wrong-loan';
    expect(await getPracticeFileAccess(current.id, file.id)).toMatchObject({ success: false });
  });
  it('requires current approval and version for the flat manifest, and rechecks changed selections before saving', async () => {
    current.package.items[0].review = 'APPROVED';
    const manifest = await preparePracticeDocumentDownload(current.id, 0);
    expect(manifest).toMatchObject({ success: true, data: { filename: 'Practice-Approved-Documents.zip', files: [{ archivePath: 'Statement.pdf' }] } });
    if (!manifest.success) throw new Error('Expected manifest');
    expect(await validatePracticeDocumentDownload(current.id, manifest.data.selectionKey)).toEqual({ success: true, data: { valid: true } });
    current.version = 1;
    expect(await validatePracticeDocumentDownload(current.id, manifest.data.selectionKey)).toMatchObject({ success: true });
    expect(await preparePracticeDocumentDownload(current.id, 0)).toMatchObject({ success: false });
    current.package.items[0].review = 'CHANGES';
    expect(await validatePracticeDocumentDownload(current.id, manifest.data.selectionKey)).toMatchObject({ success: false });
  });
  it('returns no partial manifest or raw storage errors if any URL cannot be signed', async () => {
    current.package.items[0].review = 'APPROVED'; m.sign.mockRejectedValue(new Error('https://private-storage/sensitive-path'));
    expect(await preparePracticeDocumentDownload(current.id, 0)).toEqual({ success: false, error: 'Unable to prepare this practice document. Please try again.' });
  });
});
