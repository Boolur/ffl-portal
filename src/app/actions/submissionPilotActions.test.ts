import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPilotPackage, SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';

const mocks = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn(), findMany: vi.fn() }, task: { findUnique: vi.fn(), updateMany: vi.fn() }, auditLog: { create: vi.fn() }, notification: { createMany: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn() };
  return { db, session: vi.fn(), download: vi.fn(), info: vi.fn() };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/adminTiers', () => ({ isAdmin: (role: string) => role === 'ADMIN_III', isAdminIII: (role: string) => role === 'ADMIN_III' }));
vi.mock('@/lib/ariveCrypto', () => ({ encryptAriveCredentials: vi.fn(() => 'encrypted') }));
vi.mock('@/lib/ariveClient', () => ({ ariveConfigured: vi.fn(), ariveClassifications: vi.fn(), ariveSession: vi.fn(), findAriveLoan: vi.fn(), readAriveNotes: vi.fn(), validAriveUploadUrl: vi.fn(), AriveError: class extends Error {} }));
vi.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({ storage: { from: () => ({ download: mocks.download, info: mocks.info }) } }), getTaskAttachmentsBucket: () => 'test' }));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
import { changeSubmissionPilot, downloadPilotFile, configurePilotArive, sendPilotDocumentToArive, refreshPilotAriveNotes, finishPilotUpload } from './submissionPilotActions';
import { ariveClassifications, ariveSession, validAriveUploadUrl, readAriveNotes } from '@/lib/ariveClient';

function asUser(id: string, role: string) {
  mocks.session.mockResolvedValue({ user: { id, role } });
  mocks.db.user.findUnique.mockResolvedValue({ id, name: 'Test user', role, roles: [role], active: true });
}
function packageTask() {
  const p = initialPilotPackage(); p.state = 'REVIEW';
  mocks.db.task.findUnique.mockResolvedValue({ id: 'task', kind: null, title: 'Processing submission pilot — documents', loanId: 'loan', updatedAt: new Date(), loan: { loanOfficerId: SUBMISSION_PILOT_LO_ID, borrowerName: 'Test borrower' }, submissionData: { submissionPilot: p } });
  return p;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$transaction.mockImplementation(async fn => fn(mocks.db));
  mocks.db.task.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.user.findMany.mockResolvedValue([]);
});
describe('pilot server authorization and concurrency', () => {
  it.each([
    { size: 123, contentType: 'application/pdf' },
    { metadata: { size: 123, mimetype: 'application/pdf' } },
  ])('finalizes an existing pending upload with current or older storage metadata', async data => {
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER');
    const p = packageTask(); p.state = 'DRAFT';
    p.items[0].pending = { name: 'test.pdf', path: 'submission-pilot/task/test.pdf', size: 123, type: 'application/pdf' };
    mocks.info.mockResolvedValue({ data, error: null });
    expect((await finishPilotUpload('task', 'mortgage')).success).toBe(true);
    expect(p.items[0].pending).toBeUndefined();
    expect(p.items[0].files[0].path).toBe('submission-pilot/task/test.pdf');
  });
  it('retains a pending upload when storage verification fails', async () => {
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER');
    const p = packageTask(); p.state = 'DRAFT';
    p.items[0].pending = { name: 'test.pdf', path: 'submission-pilot/task/test.pdf', size: 123, type: 'application/pdf' };
    mocks.info.mockResolvedValue({ data: null, error: { status: 503 } });
    const result = await finishPilotUpload('task', 'mortgage');
    expect(result.success).toBe(false);
    expect(p.items[0].pending).toBeDefined();
    expect(mocks.db.task.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an unrelated LO', async () => {
    asUser('other', 'LOAN_OFFICER'); packageTask();
    const r = await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'CLAIM' });
    expect(r.success).toBe(false); expect(mocks.db.task.updateMany).not.toHaveBeenCalled();
  });
  it('rejects the similarly named onboarding account', async () => {
    asUser('b9a76477-9a5e-41ad-b7b5-8a138b749907', 'ONBOARDING'); packageTask();
    expect((await downloadPilotFile('task', 'file')).success).toBe(false);
  });
  it('rejects stale revisions without saving', async () => {
    asUser('jr', 'PROCESSOR_JR'); const p = packageTask(); p.revision = 2;
    const r = await changeSubmissionPilot({ taskId: 'task', revision: 1, action: 'CLAIM' });
    expect(r.success).toBe(false); expect(mocks.db.task.updateMany).not.toHaveBeenCalled();
  });
  it('prevents the LO from approving their own submission', async () => {
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER'); packageTask();
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'APPROVE' })).success).toBe(false);
  });
  it('does not allow another Jr to take over a claimed review', async () => {
    asUser('jr2', 'PROCESSOR_JR'); const p = packageTask(); p.reviewerId = 'jr1';
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'CLAIM' })).success).toBe(false);
  });
  it('claims a submitted review and records an audit', async () => {
    asUser('jr', 'PROCESSOR_JR'); packageTask();
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'CLAIM' })).success).toBe(true);
    expect(mocks.db.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assignedUserId: 'jr' }) }));
    expect(mocks.db.auditLog.create).toHaveBeenCalledOnce();
  });
  it('requires feedback when requesting a correction', async () => {
    asUser('jr', 'PROCESSOR_JR'); const p = packageTask(); p.reviewerId = 'jr'; p.items[0].waiver = 'Purchase';
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'REVIEW', itemId: 'mortgage', approved: false })).success).toBe(false);
  });
  it('does not expose draft documents to a Jr', async () => {
    asUser('jr', 'PROCESSOR_JR'); const p = packageTask(); p.state = 'DRAFT';
    expect((await downloadPilotFile('task', 'file')).success).toBe(false);
  });
  it('routes a correction round trip and approves only after re-review', async () => {
    const p = packageTask(); p.reviewerId = 'jr';
    p.items.forEach(i => { i.waiver = 'Not applicable'; i.review = 'APPROVED'; });
    p.items[0].waiver = '';
    p.items[0].files = [{ id: 'file', path: 'private/file.pdf', name: 'statement.pdf', type: 'application/pdf', size: 100, uploadedAt: new Date().toISOString() }];
    asUser('jr', 'PROCESSOR_JR');
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 0, action: 'REVIEW', itemId: 'mortgage', approved: false, text: 'Please provide the current statement.' })).success).toBe(true);
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 1, action: 'RETURN' })).success).toBe(true);
    expect(p.state).toBe('CHANGES');
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER');
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 2, action: 'SUBMIT' })).success).toBe(false);
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 2, action: 'REMOVE', itemId: 'mortgage', fileId: 'file' })).success).toBe(true);
    expect(p.retiredFiles?.[0].id).toBe('file');
    // Upload completion changes this item back to pending review.
    p.items[0].files = [{ ...p.retiredFiles![0], id: 'replacement' }];
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 3, action: 'SUBMIT' })).success).toBe(true);
    asUser('jr', 'PROCESSOR_JR');
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 4, action: 'APPROVE' })).success).toBe(false);
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 4, action: 'REVIEW', itemId: 'mortgage', approved: true })).success).toBe(true);
    expect((await changeSubmissionPilot({ taskId: 'task', revision: 5, action: 'APPROVE' })).success).toBe(true);
    expect(p.state).toBe('APPROVED');
    expect(mocks.db.notification.createMany).toHaveBeenCalledTimes(3);
  });
});

describe('Arive pilot transfer gates', () => {
  function ready() {
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER');
    const p = packageTask(); p.state = 'APPROVED'; p.ariveLink = { id: 'guid', loanNumber: '123' };
    p.items[0].files = [{ id: 'f', path: 'private/file.pdf', name: 'file.pdf', type: 'application/pdf', size: 4, uploadedAt: new Date().toISOString() }];
    vi.mocked(ariveClassifications).mockResolvedValue([{ name: 'Income', subName: '' }]);
    vi.mocked(validAriveUploadUrl).mockReturnValue('https://bucket.s3.amazonaws.com/file');
    mocks.download.mockResolvedValue({ data: new Blob(['test']), error: null });
    return p;
  }
  it('does not allow an LO to configure company credentials', async () => {
    asUser(SUBMISSION_PILOT_LO_ID, 'LOAN_OFFICER');
    expect((await configurePilotArive({ clientId: 'test', secret: 'test', apiKey: 'test' })).success).toBe(false);
    expect(ariveClassifications).not.toHaveBeenCalled();
  });
  it('requires package approval before sending', async () => {
    const p = ready(); p.state = 'REVIEW';
    expect((await sendPilotDocumentToArive({ taskId: 'task', fileId: 'f', classification: '' })).success).toBe(false);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('sends private documents and records the returned document id', async () => {
    const p = ready();
    const api = vi.fn().mockResolvedValueOnce({ fileId: 'remote', fileUploadSignedUrl: 'https://bucket.s3.amazonaws.com/file' }).mockResolvedValueOnce({ id: 42 });
    vi.mocked(ariveSession).mockResolvedValue(api);
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 200 })); vi.stubGlobal('fetch', fetcher);
    try {
      expect((await sendPilotDocumentToArive({ taskId: 'task', fileId: 'f', classification: 'Income' })).success).toBe(true);
      expect(api.mock.calls[1][1]).toEqual({ fileId: 'remote', documentName: 'file.pdf', classificationType: 'Income' });
      expect(fetcher.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/pdf' });
      expect(p.ariveTransfers?.f.documentId).toBe(42);
      expect(p.ariveTransfers?.f.state).toBe('SENT');
      expect((await sendPilotDocumentToArive({ taskId: 'task', fileId: 'f', classification: '' })).success).toBe(false);
      expect(api).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
  it('blocks duplicate sends after an uncertain attachment response', async () => {
    const p = ready();
    const api = vi.fn().mockResolvedValueOnce({ fileId: 'remote', fileUploadSignedUrl: 'https://bucket.s3.amazonaws.com/file' }).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(ariveSession).mockResolvedValue(api); vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    try {
      expect((await sendPilotDocumentToArive({ taskId: 'task', fileId: 'f', classification: '' })).success).toBe(false);
      expect(p.ariveTransfers?.f.state).toBe('UNKNOWN');
      expect((await sendPilotDocumentToArive({ taskId: 'task', fileId: 'f', classification: '' })).success).toBe(false);
      expect(api).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
  it('retains previous notes when Arive cannot be read', async () => {
    const p = ready(); p.ariveNotes = { syncedAt: '2026-10-15', notes: [] };
    vi.mocked(readAriveNotes).mockRejectedValue(new Error('unavailable'));
    expect((await refreshPilotAriveNotes('task')).success).toBe(false);
    expect(p.ariveNotes.syncedAt).toBe('2026-10-15');
  });
});
