import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PilotPackage } from '../../lib/submissionPilot';

const mocks = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), task: vi.fn(), request: vi.fn(), storage: vi.fn(), sign: vi.fn(), write: vi.fn(), arive: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.write }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/taskLifecycleTimeline', () => ({ appendLifecycleHistoryEvent: mocks.write }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/submissionPilot', async () => ({ ...await import('../../lib/submissionPilot'), isSubmissionPilotEnabled: () => false }));
vi.mock('@/lib/ariveTrackers', () => ({ normalizeAriveTrackers: vi.fn() }));
vi.mock('@/lib/ariveCrypto', () => ({ encryptAriveCredentials: mocks.write }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: mocks.user }, task: { findUnique: mocks.task, findFirst: mocks.request, updateMany: mocks.write }, $transaction: mocks.write, auditLog: { create: mocks.write }, notification: { createMany: mocks.write } } }));
vi.mock('@/lib/ariveClient', () => ({ ariveConfigured: mocks.arive, ariveClassifications: mocks.arive, ariveSession: mocks.arive, findAriveLoan: mocks.arive, readAriveNotes: mocks.arive, validAriveUploadUrl: mocks.arive, AriveError: class extends Error {} }));
vi.mock('@/lib/supabaseAdmin', () => ({ getTaskAttachmentsBucket: () => 'test-attachments', getSupabaseAdmin: () => ({ storage: { from: mocks.storage } }) }));

import { preparePilotDocumentDownload, validatePilotDocumentDownload } from './submissionPilotActions';
import { SUBMISSION_PILOT_LO_ID } from '../../lib/submissionPilot';

let pkg: PilotPackage;
let ownerId: string;
let reviewerId: string;
let session: { user: { id: string; role: string; activeRole?: string } };
let active: boolean;
let persistedRole: string;
let persistedRoles: string[];
const approvedFile = (index: number) => ({ id: `file-${index}`, name: `File ${index}.pdf`, type: 'application/pdf', size: 3, uploadedAt: '', path: `submission-pilot/package/00000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}.pdf` });
const prepare = () => preparePilotDocumentDownload('package', 4);
async function manifest() {
  const result = await prepare();
  if (!result.success) throw new Error(result.error);
  return result.data;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  ownerId = SUBMISSION_PILOT_LO_ID; reviewerId = 'reviewer'; active = true; persistedRole = 'ADMIN_III'; persistedRoles = [];
  session = { user: { id: 'admin', role: 'ADMIN_III' } };
  pkg = { version: 1, revision: 4, state: 'REVIEW', reviewerId, history: [], items: [{ id: 'income', label: 'Income', required: true, review: 'APPROVED', feedback: '', waiver: '', files: [approvedFile(1), approvedFile(2)] }] };
  mocks.session.mockImplementation(async () => session);
  mocks.user.mockImplementation(async () => ({ id: session.user.id, name: 'Synthetic user', active, role: persistedRole, roles: persistedRoles }));
  mocks.task.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'package' ? { id: 'package', loanId: 'loan', kind: null, title: 'Processing submission pilot — documents', loan: { loanOfficerId: ownerId, borrowerName: 'Synthetic Borrower', loanNumber: '17881588' }, submissionData: { submissionPilot: structuredClone(pkg) } } : null);
  mocks.request.mockImplementation(async () => ({ id: 'request', kind: 'SUBMIT_PROCESSING', loanId: 'loan', status: 'IN_PROGRESS', workflowState: 'NONE', assignedUserId: reviewerId }));
  mocks.storage.mockReturnValue({ createSignedUrl: mocks.sign });
  mocks.sign.mockImplementation(async (path: string) => ({ data: { signedUrl: `https://storage.example.test/signed/${path.split('/').at(-1)}` }, error: null }));
});
afterEach(() => vi.unstubAllGlobals());

describe('approved document download authorization', () => {
  it.each(['signed out', 'inactive', 'unassigned active role', 'other loan owner', 'other LO', 'different reviewer', 'draft to reviewer'])('rejects %s before signing', async scenario => {
    if (scenario === 'signed out') mocks.session.mockResolvedValue(null);
    if (scenario === 'inactive') active = false;
    if (scenario === 'unassigned active role') session.user.activeRole = 'MANAGER';
    if (scenario === 'other loan owner') ownerId = 'other-owner';
    if (scenario === 'other LO') { session.user = { id: 'other-lo', role: 'LOAN_OFFICER' }; persistedRole = 'LOAN_OFFICER'; }
    if (scenario === 'different reviewer') { session.user = { id: 'other-reviewer', role: 'PROCESSOR_JR' }; persistedRole = 'PROCESSOR_JR'; }
    if (scenario === 'draft to reviewer') pkg.state = 'DRAFT';
    expect(await prepare()).toMatchObject({ success: false });
    expect(await validatePilotDocumentDownload('package', 'a'.repeat(64))).toMatchObject({ success: false });
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it.each(['ADMIN_III', 'MANAGER', 'PROCESSING_MANAGER', 'PROCESSOR_JR', 'LOAN_OFFICER'])('preserves existing %s read permissions while the submission pilot is paused', async role => {
    persistedRole = role;
    session.user = { role, id: role === 'LOAN_OFFICER' ? SUBMISSION_PILOT_LO_ID : role === 'PROCESSOR_JR' ? reviewerId : 'admin' };
    expect(await prepare()).toMatchObject({ success: true });
  });
});

describe('approved document manifest', () => {
  it('returns original filenames and signed approved files, without raw paths or writes', async () => {
    const before = JSON.stringify(pkg);
    const result = await manifest();
    expect(result).toMatchObject({ filename: 'Arive-17881588-Approved-Documents.zip', totalBytes: 6, files: [{ id: 'file-1', name: 'File 1.pdf', archivePath: 'Income/File 1.pdf' }, { id: 'file-2', name: 'File 2.pdf' }] });
    expect(result.selectionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files.every(file => !('storagePath' in file) && !('categoryId' in file))).toBe(true);
    expect(mocks.sign).toHaveBeenCalledWith(pkg.items[0].files[0].path, 300, { download: 'File 1.pdf' });
    expect(JSON.stringify(pkg)).toBe(before); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.arive).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses an old displayed revision before contacting storage', async () => {
    expect(await preparePilotDocumentDownload('package', 3)).toMatchObject({ success: false, error: expect.stringContaining('Refresh') });
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('signs only currently approved categories and omits pending/retired files', async () => {
    pkg.retiredFiles = [approvedFile(9)];
    pkg.items.push({ ...pkg.items[0], id: 'pending', files: [approvedFile(3)], review: 'PENDING' }, { ...pkg.items[0], id: 'changes', files: [approvedFile(4)], review: 'CHANGES' }, { ...pkg.items[0], id: 'uploading', files: [approvedFile(5)], pending: { name: 'New.pdf', type: 'application/pdf', size: 3, path: 'pending' } });
    expect((await manifest()).files.map(file => file.id)).toEqual(['file-1', 'file-2']);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });
  it.each(['error', 'throw', 'missing URL'])('returns no partial manifest or storage details on signing %s', async scenario => {
    mocks.sign.mockImplementation(async (path: string) => {
      if (path === pkg.items[0].files[1].path) {
        if (scenario === 'throw') throw new Error('SECRET URL https://secret.example.test');
        return { data: null, error: scenario === 'error' ? { message: 'SECRET bucket details' } : null };
      }
      return { data: { signedUrl: 'https://storage.example.test/valid' }, error: null };
    });
    const result = await prepare();
    expect(result).toEqual({ success: false, error: 'Unable to prepare all approved documents. Please try again.' });
    expect('data' in result).toBe(false);
  });
  it('discards signed results if approval changes during preparation', async () => {
    mocks.sign.mockImplementation(async () => { pkg.items[0].review = 'CHANGES'; return { data: { signedUrl: 'https://storage.example.test/valid' }, error: null }; });
    expect(await prepare()).toMatchObject({ success: false });
  });
  it('limits signing concurrency to four', async () => {
    pkg.items[0].files = Array.from({ length: 10 }, (_, index) => approvedFile(index));
    let concurrent = 0; let maximum = 0;
    mocks.sign.mockImplementation(async () => { concurrent++; maximum = Math.max(maximum, concurrent); await new Promise(resolve => setTimeout(resolve, 1)); concurrent--; return { data: { signedUrl: 'https://storage.example.test/signed' }, error: null }; });
    expect((await manifest()).files).toHaveLength(10); expect(maximum).toBe(4);
  });
});

describe('before-save document selection validation', () => {
  it('accepts unchanged files after notes and transfer revisions without signing again', async () => {
    const result = await manifest();
    pkg.revision++; pkg.history.push({ actor: 'Reviewer', message: 'Imported notes', at: '' }); pkg.ariveTransfers = { 'file-1': { state: 'SENT', attemptId: 'id', at: '' } };
    mocks.sign.mockClear();
    expect(await validatePilotDocumentDownload('package', result.selectionKey)).toMatchObject({ success: true });
    expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(['approval revoked', 'file replaced', 'file removed', 'pending replacement', 'renamed', 'category renamed'])('rejects %s before the archive can be saved', async scenario => {
    const result = await manifest();
    if (scenario === 'approval revoked') pkg.items[0].review = 'CHANGES';
    if (scenario === 'file replaced') pkg.items[0].files[1] = approvedFile(3);
    if (scenario === 'file removed') pkg.items[0].files.pop();
    if (scenario === 'pending replacement') pkg.items[0].pending = { name: 'New.pdf', type: 'application/pdf', size: 3, path: 'pending' };
    if (scenario === 'renamed') pkg.items[0].files[0].name = 'Updated.pdf';
    if (scenario === 'category renamed') pkg.items[0].label = 'Updated category';
    expect(await validatePilotDocumentDownload('package', result.selectionKey)).toMatchObject({ success: false });
  });
  it('reauthenticates instead of trusting a previously issued selection key', async () => {
    const result = await manifest(); active = false;
    expect(await validatePilotDocumentDownload('package', result.selectionKey)).toMatchObject({ success: false, error: 'Account unavailable.' });
  });
});
