import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialPilotPackage, SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';

const mocks = vi.hoisted(() => {
  const db = { user: { findUnique: vi.fn(), findMany: vi.fn() }, task: { findUnique: vi.fn(), updateMany: vi.fn() }, auditLog: { create: vi.fn() }, notification: { createMany: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn() };
  return { db, session: vi.fn() };
});
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/adminTiers', () => ({ isAdmin: (role: string) => role === 'ADMIN_III' }));
vi.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: vi.fn(), getTaskAttachmentsBucket: () => 'test' }));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
import { changeSubmissionPilot, downloadPilotFile } from './submissionPilotActions';

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
