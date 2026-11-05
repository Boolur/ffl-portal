import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), loan: vi.fn(), api: vi.fn(), ariveSession: vi.fn(), auditCreate: vi.fn(), auditFind: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, loan: { findUnique: mocks.loan }, auditLog: { create: mocks.auditCreate }, $transaction: mocks.transaction } }));
vi.mock('@/lib/ariveClient', () => ({ ariveSession: mocks.ariveSession, AriveError: class AriveError extends Error {} }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/submissionPilot', async () => import('../../lib/submissionPilot'));
vi.mock('@/lib/ariveStatusTest', async () => import('../../lib/ariveStatusTest'));
import { readAriveTestStatus, updateAriveTestStatus } from './ariveStatusTestActions';
import { AriveError } from '@/lib/ariveClient';
import { SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';

const original = () => ({ ariveLoanId: 17881588, sysGUID: 'test-loan-guid', loanOriginatorEmail: 'matt@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'TESTING', lastName: 'TESTER' }], currentLoanStatus: { status: 'APPLICATION_INTAKE', date: '2026-10-15' }, loanStatusHistory: [{ status: 'APPLICATION_INTAKE', date: '2026-10-15' }] });
type Log = { id: string; action: string; details: string; createdAt: Date; userId: string; loanId: string };
let receipt: Log | null;
let latest: Log | null;
let before: ReturnType<typeof original>;
let after: ReturnType<typeof original>;
let patched: boolean;
let patchFailure: boolean;
let readbackFailure: boolean;
let serial: number;

beforeEach(() => {
  vi.clearAllMocks();
  receipt = null; latest = null; serial = 0; patched = false; patchFailure = false; readbackFailure = false;
  before = original(); after = { ...original(), currentLoanStatus: { status: 'QUALIFICATION', date: '2026-11-05' }, loanStatusHistory: [...original().loanStatusHistory, { status: 'QUALIFICATION', date: '2026-11-05' }] };
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III' } });
  mocks.user.mockResolvedValue({ active: true, role: 'ADMIN_III', roles: ['ADMIN_III'] });
  mocks.loan.mockResolvedValue({ id: 'portal-loan', loanOfficerId: SUBMISSION_PILOT_LO_ID, borrowerName: 'TESTING TESTER', loanOfficer: { active: true, email: 'matt@example.test' } });
  mocks.ariveSession.mockResolvedValue(mocks.api);
  mocks.api.mockImplementation(async (path: string, _body?: unknown, method?: string) => {
    if (path.includes('searchField=')) return { rows: [{ ariveLoanId: 17881588, sysGUID: 'test-loan-guid' }] };
    if (method === 'PATCH') { patched = true; if (patchFailure) throw new Error('private provider detail'); return { status: 200 }; }
    if (patched && readbackFailure) throw new Error('private readback failure');
    return patched ? after : before;
  });
  mocks.auditCreate.mockImplementation(async ({ data }: { data: Omit<Log, 'id' | 'createdAt'> }) => {
    const log = { ...data, id: `log-${++serial}`, createdAt: new Date(Date.now() - (data.action === 'ARIVE_TEST_STAGE_READ' ? 100 : 0)) };
    if (data.action === 'ARIVE_TEST_STAGE_READ') receipt = log; else latest = log;
    return log;
  });
  mocks.auditFind.mockImplementation(async ({ where }: { where: { id?: string; userId?: string } }) => where.id ? (receipt?.id === where.id && receipt.userId === where.userId ? receipt : null) : latest);
  mocks.transaction.mockImplementation(async work => work({ $executeRaw: mocks.lock, auditLog: { findFirst: mocks.auditFind, create: mocks.auditCreate } }));
});
async function ready() {
  const read = await readAriveTestStatus();
  if (!read.success) throw new Error(read.error);
  return { readId: read.data.readId, expected: read.data.stage, target: 'QUALIFICATION' };
}
const patchCalls = () => mocks.api.mock.calls.filter(call => call[2] === 'PATCH');

describe('status test authorization and scope', () => {
  it.each(['signed out', 'inactive', 'unassigned role', 'lower admin', 'wrong active role'])('denies %s before Arive requests', async scenario => {
    if (scenario === 'signed out') mocks.session.mockResolvedValue(null);
    if (scenario === 'inactive') mocks.user.mockResolvedValue({ active: false, role: 'ADMIN_III', roles: [] });
    if (scenario === 'unassigned role') mocks.user.mockResolvedValue({ active: true, role: 'LOAN_OFFICER', roles: [] });
    if (scenario === 'lower admin') { mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_II' } }); mocks.user.mockResolvedValue({ active: true, role: 'ADMIN_II', roles: [] }); }
    if (scenario === 'wrong active role') { mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III', activeRole: 'LOAN_OFFICER' } }); mocks.user.mockResolvedValue({ active: true, role: 'ADMIN_III', roles: ['LOAN_OFFICER'] }); }
    expect((await readAriveTestStatus()).success).toBe(false);
    expect((await updateAriveTestStatus({ readId: 'none', expected: 'APPLICATION_INTAKE', target: 'QUALIFICATION' })).success).toBe(false);
    expect(mocks.ariveSession).not.toHaveBeenCalled();
  });
  it('allows an assigned active secondary Admin III role', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'LOAN_OFFICER', activeRole: 'ADMIN_III' } });
    mocks.user.mockResolvedValue({ active: true, role: 'LOAN_OFFICER', roles: ['ADMIN_III'] });
    expect((await readAriveTestStatus()).success).toBe(true);
  });
  it.each(['missing loan', 'wrong owner', 'wrong name'])('rejects %s in the portal before calling Arive', async scenario => {
    mocks.loan.mockResolvedValue(scenario === 'missing loan' ? null : { id: 'portal-loan', loanOfficerId: scenario === 'wrong owner' ? 'someoneelse' : SUBMISSION_PILOT_LO_ID, borrowerName: scenario === 'wrong name' ? 'Actual Client' : 'TESTING TESTER', loanOfficer: { active: true, email: 'matt@example.test' } });
    expect((await readAriveTestStatus()).success).toBe(false);
    expect(mocks.ariveSession).not.toHaveBeenCalled();
  });
  it('revalidates the remote originator before a write', async () => {
    const input = await ready(); before.loanOriginatorEmail = 'another@example.test';
    expect((await updateAriveTestStatus(input)).success).toBe(false);
    expect(patchCalls()).toHaveLength(0);
  });
});

describe('stage concurrency and readback', () => {
  it('exposes only validated stage/date history in a read-only snapshot', async () => {
    Object.assign(before.loanStatusHistory[0], { privateDetail: 'PRIVATE_FIELD' });
    const result = await readAriveTestStatus();
    expect(result).toMatchObject({ success: true, data: { history: [{ stage: 'APPLICATION_INTAKE', date: '2026-10-15' }], historyCount: 1 } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_FIELD');
    expect(patchCalls()).toHaveLength(0);
  });
  it('audits one PATCH, verifies the new stage plus historical entries, and consumes the read receipt', async () => {
    const input = await ready();
    const result = await updateAriveTestStatus(input);
    expect(result).toMatchObject({ success: true, data: { stage: 'QUALIFICATION', readId: '' } });
    expect(patchCalls()).toHaveLength(1);
    expect(patchCalls()[0][0]).toBe('/loans/17881588?sync=true');
    const detailReads = mocks.api.mock.calls.filter(call => call[0] === '/loans/test-loan-guid' && call[2] !== 'PATCH');
    expect(detailReads).toHaveLength(3); // initial read, pre-write identity check, and readback
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.auditCreate.mock.calls.map(call => call[0].data.action)).toEqual(['ARIVE_TEST_STAGE_READ', 'ARIVE_TEST_STAGE_REQUESTED', 'ARIVE_TEST_STAGE_VERIFIED']);
    expect(JSON.parse(latest!.details).observedStages).toEqual([{ stage: 'APPLICATION_INTAKE', date: '2026-10-15' }, { stage: 'QUALIFICATION', date: '2026-11-05' }]);
    patched = false;
    expect((await updateAriveTestStatus(input)).success).toBe(false);
    expect(patchCalls()).toHaveLength(1);
  });
  it('rejects changed history even when the current stage remains the same', async () => {
    const input = await ready(); before.loanStatusHistory.push({ status: 'LOAN_SETUP', date: '2026-10-16' });
    expect(await updateAriveTestStatus(input)).toMatchObject({ success: false, error: expect.stringContaining('history changed') });
    expect(patchCalls()).toHaveLength(0);
  });
  it('requires a matching, recent, caller-owned read receipt', async () => {
    const input = await ready();
    for (const scenario of ['missing', 'different user', 'expired']) {
      if (scenario === 'missing') input.readId = 'not-found';
      if (scenario === 'different user') { input.readId = receipt!.id; receipt!.userId = 'another-admin'; }
      if (scenario === 'expired') { receipt!.userId = 'admin'; receipt!.createdAt = new Date(Date.now() - 6 * 60_000); }
      expect((await updateAriveTestStatus(input)).success).toBe(false);
    }
    expect(patchCalls()).toHaveLength(0);
  });
  it('blocks another write while a previous attempt has no recorded result, even with a newer read', async () => {
    const input = await ready();
    latest = { ...receipt!, id: 'pending-attempt', action: 'ARIVE_TEST_STAGE_REQUESTED', createdAt: new Date(Date.now() - 1000) };
    expect(await updateAriveTestStatus(input)).toMatchObject({ success: false, error: expect.stringContaining('still being verified') });
    expect(patchCalls()).toHaveLength(0);
  });
  it('reads back after a timed-out write and reports success only when stage and history are confirmed', async () => {
    const input = await ready(); patchFailure = true;
    expect(await updateAriveTestStatus(input)).toMatchObject({ success: true, data: { stage: 'QUALIFICATION' } });
    expect(patchCalls()).toHaveLength(1);
    expect(JSON.parse(latest!.details).acknowledged).toBe(false);
    expect(latest!.details).not.toContain('private provider');
  });
  it.each(['lost history', 'wrong stage', 'readback failed'])('leaves %s unresolved without replaying the write', async scenario => {
    const input = await ready();
    if (scenario === 'lost history') after.loanStatusHistory = [];
    if (scenario === 'wrong stage') after = original();
    if (scenario === 'readback failed') readbackFailure = true;
    expect(await updateAriveTestStatus(input)).toMatchObject({ success: false, requiresRefresh: true, error: expect.stringContaining('No automatic retry') });
    expect(patchCalls()).toHaveLength(1);
    expect(latest!.action).toBe('ARIVE_TEST_STAGE_UNCERTAIN');
    const observed = JSON.parse(latest!.details).observedStages;
    if (scenario === 'lost history') expect(observed).toEqual([{ stage: 'QUALIFICATION', date: '2026-11-05' }]);
    if (scenario === 'wrong stage') expect(observed).toEqual([{ stage: 'APPLICATION_INTAKE', date: '2026-10-15' }]);
    if (scenario === 'readback failed') expect(observed).toBeNull();
    patched = false;
    expect((await updateAriveTestStatus(input)).success).toBe(false);
    expect(patchCalls()).toHaveLength(1);
  });
  it('reports sanitized permission failures and observed stage when the update is not confirmed', async () => {
    const input = await ready(); after = original();
    const normal = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (...args) => {
      if (args[2] === 'PATCH') { patched = true; throw new AriveError('Arive API request returned HTTP 403. Check the credentials and Arive-provisioned permission for this operation.'); }
      return normal(...args);
    });
    const result = await updateAriveTestStatus(input);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('HTTP 403') });
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('Readback stage: APPLICATION_INTAKE. Existing history was preserved.') });
    expect(patchCalls()).toHaveLength(1);
  });
  it('does not expose unexpected database error details', async () => {
    mocks.user.mockRejectedValue(new Error('PRIVATE_DATABASE_VALUE'));
    expect(JSON.stringify(await readAriveTestStatus())).not.toContain('PRIVATE_DATABASE_VALUE');
  });
});
