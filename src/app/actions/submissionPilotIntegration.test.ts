import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PilotPackage } from '../../lib/submissionPilot';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), findUser: vi.fn(), findTask: vi.fn(), findRequest: vi.fn(), updateTask: vi.fn(),
  transaction: vi.fn(), lock: vi.fn(), configured: vi.fn(), classifications: vi.fn(),
  findLoan: vi.fn(), readNotes: vi.fn(), ariveSession: vi.fn(), api: vi.fn(),
  storage: vi.fn(), download: vi.fn(), enabled: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/taskLifecycleTimeline', () => ({ appendLifecycleHistoryEvent: vi.fn() }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/submissionPilot', async () => ({ ...await import('../../lib/submissionPilot'), isSubmissionPilotEnabled: mocks.enabled }));
vi.mock('@/lib/ariveTrackers', async () => import('../../lib/ariveTrackers'));
vi.mock('@/lib/ariveCrypto', () => ({ encryptAriveCredentials: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: mocks.findUser },
  task: { findUnique: mocks.findTask, findFirst: mocks.findRequest, updateMany: mocks.updateTask },
  $transaction: mocks.transaction, $executeRaw: mocks.lock,
} }));
vi.mock('@/lib/ariveClient', () => ({
  ariveConfigured: mocks.configured, ariveClassifications: mocks.classifications,
  ariveSession: mocks.ariveSession, findAriveLoan: mocks.findLoan, readAriveNotes: mocks.readNotes,
  validAriveUploadUrl: (url: string) => url, AriveError: class AriveError extends Error {},
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getTaskAttachmentsBucket: () => 'test-attachments',
  getSupabaseAdmin: () => ({ storage: { from: mocks.storage } }),
}));

import {
  getAriveTestWorkspace, refreshPilotAriveNotes, getPilotAriveClassifications,
  sendPilotDocumentToArive, linkExistingAriveTestPackage, prepareProcessingSubmissionUpload, getPilotAriveTrackers,
} from './submissionPilotActions';
import { SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';

let pkg: PilotPackage;
let loan: { loanOfficerId: string; borrowerName: string; loanNumber: string };
let request: { id: string; kind: string; loanId: string; status: string; workflowState: string; assignedUserId: string | null; submissionData: { processingDocumentTaskId: string } };
const send = () => sendPilotDocumentToArive({ taskId: 'package', fileId: 'file', classification: '' });
const operations = [
  ['workspace', () => getAriveTestWorkspace('request')],
  ['notes', () => refreshPilotAriveNotes('package')],
  ['trackers', () => getPilotAriveTrackers('package')],
  ['classifications', () => getPilotAriveClassifications('package')],
  ['document transfer', send],
  ['link', () => linkExistingAriveTestPackage('package')],
] as const;
function expectNoProviderAccess() {
  for (const fn of [mocks.configured, mocks.classifications, mocks.findLoan, mocks.readNotes, mocks.ariveSession, mocks.storage]) expect(fn).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  // These cases explicitly exercise integration access while general enrollment is paused.
  mocks.enabled.mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  pkg = { version: 1, revision: 31, state: 'APPROVED', reviewerId: 'reviewer', history: [],
    ariveLink: { id: 'remote-test', loanNumber: '17881588' },
    items: [{ id: 'income', label: 'Income', required: true, waiver: '', review: 'APPROVED', feedback: '',
      files: [{ id: 'file', name: 'synthetic.pdf', path: 'test/file.pdf', size: 3, type: 'application/pdf', uploadedAt: '2026-11-05T00:00:00Z' }] }],
  };
  loan = { loanOfficerId: SUBMISSION_PILOT_LO_ID, borrowerName: 'TESTING TESTER', loanNumber: '17881588' };
  request = { id: 'request', kind: 'SUBMIT_PROCESSING', loanId: 'loan', status: 'COMPLETED', workflowState: 'NONE', assignedUserId: 'reviewer', submissionData: { processingDocumentTaskId: 'package' } };
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III' } });
  mocks.findUser.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === SUBMISSION_PILOT_LO_ID
    ? { email: 'matt@example.test' }
    : { id: 'admin', name: 'Test Admin', email: 'admin@example.test', active: true, role: 'ADMIN_III', roles: ['ADMIN_III'] });
  mocks.findTask.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'request' ? structuredClone(request)
    : where.id === 'package' ? { id: 'package', kind: null, title: 'Processing submission pilot — documents', loanId: 'loan', loan: structuredClone(loan), updatedAt: new Date('2026-11-05'), submissionData: { submissionPilot: structuredClone(pkg) } } : null);
  mocks.findRequest.mockImplementation(async () => structuredClone(request));
  mocks.updateTask.mockImplementation(async ({ data }: { data: { submissionData: { submissionPilot: PilotPackage } } }) => { pkg = structuredClone(data.submissionData.submissionPilot); return { count: 1 }; });
  mocks.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({
    $executeRaw: mocks.lock, task: { findUnique: mocks.findTask, findFirst: mocks.findRequest, updateMany: mocks.updateTask },
  }));
  mocks.configured.mockResolvedValue(true);
  mocks.classifications.mockResolvedValue([{ name: 'Income', subName: '' }]);
  mocks.findLoan.mockResolvedValue({ ariveLoanId: 17881588, sysGUID: 'remote-test', loanOriginatorEmail: 'matt@example.test', loanBorrowers: [{ firstName: 'TESTING', lastName: 'TESTER', applicantType: 'Borrower' }] });
  mocks.readNotes.mockResolvedValue([{ id: 'note', text: 'Synthetic note', author: 'Test Admin', createdAt: '2026-11-05T00:00:00Z', updatedAt: '', replies: [] }]);
  mocks.ariveSession.mockResolvedValue(mocks.api);
  mocks.api.mockImplementation(async (path: string) => path.includes('/file-access?')
    ? { fileId: 'remote-file', fileUploadSignedUrl: 'https://test.s3.amazonaws.com/synthetic' } : { id: 42 });
  mocks.storage.mockReturnValue({ download: mocks.download });
  mocks.download.mockResolvedValue({ data: new Blob(['pdf'], { type: 'application/pdf' }), error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('paused submission pilot integration boundary', () => {
  it('keeps Matt’s general LO submission uploads paused', async () => {
    expect(mocks.enabled()).toBe(false);
    expect(await prepareProcessingSubmissionUpload({ name: 'synthetic.pdf', size: 3, type: 'application/pdf' })).toMatchObject({ success: false, error: expect.stringContaining('paused') });
    expectNoProviderAccess();
  });
  it.each(operations)('rejects another loan before %s touches provider or storage', async (_name, operation) => {
    loan.loanNumber = '99999999';
    expect(await operation()).toMatchObject({ success: false, error: expect.stringContaining('limited to TESTING TESTER') });
    expectNoProviderAccess();
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
  it.each(operations)('rejects another owner before %s touches provider or storage', async (_name, operation) => {
    loan.loanOfficerId = 'another-lo';
    expect(await operation()).toMatchObject({ success: false, error: 'Pilot package not found.' });
    expectNoProviderAccess();
  });
  it.each(operations)('rejects a mismatched stored link before %s touches provider or storage', async (_name, operation) => {
    pkg.ariveLink!.loanNumber = '99999999';
    expect(await operation()).toMatchObject({ success: false, error: expect.stringContaining('saved Arive link does not match') });
    expectNoProviderAccess();
  });
  it.each(operations)('requires a signed-in user for %s', async (_name, operation) => {
    mocks.session.mockResolvedValue(null);
    expect(await operation()).toMatchObject({ success: false, error: expect.stringContaining('Sign in') });
    expectNoProviderAccess();
  });
  it.each(['inactive', 'unassigned role', 'other LO', 'different assigned reviewer'] as const)('rejects %s', async scenario => {
    if (scenario === 'inactive') mocks.findUser.mockResolvedValue({ id: 'admin', active: false });
    if (scenario === 'unassigned role') mocks.findUser.mockResolvedValue({ id: 'admin', active: true, role: 'LOAN_OFFICER', roles: [] });
    if (scenario === 'other LO') {
      mocks.session.mockResolvedValue({ user: { id: 'other', role: 'LOAN_OFFICER' } });
      mocks.findUser.mockResolvedValue({ id: 'other', active: true, role: 'LOAN_OFFICER', roles: [] });
    }
    if (scenario === 'different assigned reviewer') {
      mocks.session.mockResolvedValue({ user: { id: 'other', role: 'PROCESSOR_JR' } });
      mocks.findUser.mockResolvedValue({ id: 'other', active: true, role: 'PROCESSOR_JR', roles: [] });
    }
    for (const [, operation] of operations) expect((await operation()).success).toBe(false);
    expectNoProviderAccess();
  });
});

describe('test-file workspace and link identity', () => {
  it('loads its approved package while general submissions remain paused', async () => {
    expect(await getAriveTestWorkspace('request')).toMatchObject({ success: true, data: { canConfigureArive: true, packages: [{ id: 'package', loanId: 'loan', loanNumber: '17881588', package: { state: 'APPROVED' } }] } });
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
  it('rejects a request pointing at a package from another loan', async () => {
    request.loanId = 'another-loan';
    expect((await getAriveTestWorkspace('request')).success).toBe(false);
    expectNoProviderAccess();
  });
  it('rejects a non-submission request', async () => {
    request.kind = 'LO_NEEDS_INFO';
    expect((await getAriveTestWorkspace('request')).success).toBe(false);
    expectNoProviderAccess();
  });
  it('requires a scoped package when loading classifications while paused', async () => {
    expect(await getPilotAriveClassifications()).toMatchObject({ success: false, error: 'Choose the test file first.' });
    expectNoProviderAccess();
  });
  it('links the exact loan after checking the originator', async () => {
    delete pkg.ariveLink;
    expect((await linkExistingAriveTestPackage('package')).success).toBe(true);
    expect(mocks.findLoan).toHaveBeenCalledWith('17881588');
    expect(pkg.ariveLink).toEqual({ id: 'remote-test', loanNumber: '17881588' });
    expect(pkg.revision).toBe(32);
  });
  it('does not link an originator mismatch', async () => {
    mocks.findLoan.mockResolvedValue({ sysGUID: 'remote-test', loanOriginatorEmail: 'other@example.test' });
    expect(await linkExistingAriveTestPackage('package')).toMatchObject({ success: false, error: expect.stringContaining('originator') });
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
  it('does not overwrite a different existing Arive identity', async () => {
    pkg.ariveLink!.id = 'different-remote';
    expect(await linkExistingAriveTestPackage('package')).toMatchObject({ success: false, error: expect.stringContaining('different Arive loan') });
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
});

describe('test-file notes and document transfer', () => {
  it('reads service progress without changing the package or portal milestones', async () => {
    mocks.api.mockResolvedValue({ loanTrackers: [{ name: 'TITLE', displayName: 'Title', currentTrackerStatus: { name: 'ORDERED', displayName: 'Ordered', date: '2026-11-05' } }] });
    expect(await getPilotAriveTrackers('package')).toMatchObject({ success: true, data: { trackers: [{ name: 'TITLE', status: 'ORDERED', date: '2026-11-05' }] } });
    expect(mocks.api).toHaveBeenCalledWith('/loans/remote-test/trackers');
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('does not read trackers until the test package has been linked', async () => {
    delete pkg.ariveLink;
    expect(await getPilotAriveTrackers('package')).toMatchObject({ success: false, error: expect.stringContaining('Link this Arive test file') });
    expectNoProviderAccess();
  });
  it('imports notes without changing approval or reviewer assignment', async () => {
    expect((await refreshPilotAriveNotes('package')).success).toBe(true);
    expect(mocks.readNotes).toHaveBeenCalledWith('remote-test');
    expect(pkg.ariveNotes?.notes[0].text).toBe('Synthetic note');
    expect(pkg.state).toBe('APPROVED');
    expect(pkg.reviewerId).toBe('reviewer');
  });
  it('preserves existing notes on an incomplete provider response', async () => {
    pkg.ariveNotes = { syncedAt: '2026-11-04T00:00:00Z', notes: [] };
    mocks.readNotes.mockRejectedValue(new Error('Incomplete pagination'));
    expect((await refreshPilotAriveNotes('package')).success).toBe(false);
    expect(pkg.ariveNotes.syncedAt).toBe('2026-11-04T00:00:00Z');
    expect(mocks.updateTask).not.toHaveBeenCalled();
  });
  it('rechecks the loan scope before persisting a note refresh', async () => {
    mocks.readNotes.mockImplementation(async () => { loan.loanNumber = '99999999'; return []; });
    expect(await refreshPilotAriveNotes('package')).toMatchObject({ success: false, error: expect.stringContaining('limited to TESTING TESTER') });
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(pkg.ariveNotes).toBeUndefined();
  });
  it('does not upload a package that has not been approved', async () => {
    pkg.state = 'REVIEW';
    expect(await send()).toMatchObject({ success: false, error: expect.stringContaining('approve') });
    expectNoProviderAccess();
  });
  it.each(['SENT', 'SENDING', 'UNKNOWN'] as const)('prevents duplicate transfer for %s state', async state => {
    pkg.ariveTransfers = { file: { state, attemptId: 'previous', at: '2026-11-05T00:00:00Z' } };
    expect((await send()).success).toBe(false);
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.ariveSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps borrower visibility omitted and records a confirmed attachment', async () => {
    expect((await send()).success).toBe(true);
    expect(mocks.api).toHaveBeenLastCalledWith('/loans/remote-test/documents', { fileId: 'remote-file', documentName: 'synthetic.pdf' });
    expect(pkg.ariveTransfers?.file).toMatchObject({ state: 'SENT', documentId: 42 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('stops before storage or upload when classification permission is denied', async () => {
    mocks.classifications.mockRejectedValue(new Error('Arive document classification access check returned HTTP 403.'));
    expect(await send()).toMatchObject({ success: false, error: expect.stringContaining('HTTP 403') });
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.ariveSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks automatic replay after ambiguous attachment confirmation', async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path.includes('/file-access?')) return { fileId: 'remote-file', fileUploadSignedUrl: 'https://test.s3.amazonaws.com/synthetic' };
      throw new Error('Response lost after attachment');
    });
    expect((await send()).success).toBe(false);
    expect(pkg.ariveTransfers?.file.state).toBe('UNKNOWN');
    expect((await send()).success).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
