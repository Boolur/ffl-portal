import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), configured: vi.fn(), sync: vi.fn(), db: {
  user: { findUnique: vi.fn() }, processingPipelineLoan: { findUnique: vi.fn() },
  arivePipelineSync: { upsert: vi.fn(), findUnique: vi.fn(), update: vi.fn() }, auditLog: { create: vi.fn() },
  $executeRaw: vi.fn(), $transaction: vi.fn(),
} }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveSyncTypes', async () => import('../../lib/ariveSyncTypes'));
vi.mock('@/lib/prisma', () => ({ prisma: m.db }));
vi.mock('@/lib/ariveClient', () => ({ AriveError: class AriveError extends Error {}, ariveConfigured: m.configured }));
vi.mock('@/lib/arivePipelineSync', () => ({ syncArivePipeline: m.sync, assertAriveSyncPilot: (loan: { id: string; loanNumber: string; loanOfficerId: string }) => {
  if (loan.id !== 'e29decf7-02e7-4032-929f-348e0822868f' || loan.loanNumber !== '17881588' || loan.loanOfficerId !== '2e28c6a5-67c0-442d-94bd-59897ad8d8cd') throw new Error('scope');
} }));
import { acknowledgeArivePipelineConflicts, setArivePipelineSyncEnabled, syncArivePipelineNow } from './arivePipelineSyncActions';
const row = { id: 'pipeline', loanId: 'e29decf7-02e7-4032-929f-348e0822868f', loan: { id: 'e29decf7-02e7-4032-929f-348e0822868f', loanNumber: '17881588', loanOfficerId: '2e28c6a5-67c0-442d-94bd-59897ad8d8cd' } };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('CRON_SECRET', 'test-scheduler-secret');
  m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III', activeRole: 'ADMIN_III' } });
  m.db.user.findUnique.mockResolvedValue({ id: 'admin', active: true, role: 'ADMIN_III', roles: [] });
  m.db.processingPipelineLoan.findUnique.mockResolvedValue(structuredClone(row));
  m.db.$transaction.mockImplementation(async fn => fn(m.db));
  m.configured.mockResolvedValue(true); m.sync.mockResolvedValue({ success: true });
  m.db.arivePipelineSync.findUnique.mockResolvedValue({ id: 'sync', enabled: true, conflicts: [{ field: 'titleStatus' }] });
});
describe('Arive pilot management boundary', () => {
  it.each(['LOAN_OFFICER', 'PROCESSOR_JR', 'ADMIN_II'])('denies %s without attempting sync or saving', async role => {
    m.session.mockResolvedValue({ user: { id: 'admin', role } });
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: true })).toMatchObject({ success: false });
    expect(m.db.arivePipelineSync.upsert).not.toHaveBeenCalled(); expect(m.sync).not.toHaveBeenCalled();
  });
  it.each([{ active: false, role: 'ADMIN_III', roles: [] }, { active: true, role: 'ADMIN_II', roles: [] }])('denies a stale admin session using fresh account permissions', async user => {
    m.db.user.findUnique.mockResolvedValue({ id: 'admin', ...user });
    expect(await syncArivePipelineNow({ id: 'pipeline' })).toMatchObject({ success: false }); expect(m.sync).not.toHaveBeenCalled();
  });
  it('denies preview deployments even with an admin and credentials', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: true })).toMatchObject({ success: false, error: expect.stringContaining('preview') });
    expect(m.db.arivePipelineSync.upsert).not.toHaveBeenCalled();
  });
  it('refuses enrollment for another loan', async () => {
    m.db.processingPipelineLoan.findUnique.mockResolvedValue({ ...row, loan: { ...row.loan, loanNumber: '999' } });
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: true })).toMatchObject({ success: false }); expect(m.sync).not.toHaveBeenCalled();
  });
  it('requires the production scheduler secret before enabling', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: true })).toMatchObject({ success: false, error: expect.stringContaining('CRON_SECRET') });
    expect(m.db.arivePipelineSync.upsert).not.toHaveBeenCalled();
  });
  it('enables only the existing row, audits, and performs the first read', async () => {
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: true })).toMatchObject({ success: true });
    expect(m.db.arivePipelineSync.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { pipelineId: 'pipeline' }, create: expect.objectContaining({ enabled: true, ariveLoanId: '17881588', enabledById: 'admin' }) }));
    expect(m.sync).toHaveBeenCalledWith('pipeline', { force: true });
  });
  it('pausing cancels the lease without a remote read or requiring a scheduler secret', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect(await setArivePipelineSyncEnabled({ id: 'pipeline', enabled: false })).toMatchObject({ success: true });
    expect(m.db.arivePipelineSync.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ enabled: false, leaseToken: null, leaseUntil: null }) }));
    expect(m.sync).not.toHaveBeenCalled();
  });
  it('manual refresh cannot implicitly enable a paused file', async () => {
    m.db.arivePipelineSync.findUnique.mockResolvedValue({ enabled: false });
    expect(await syncArivePipelineNow({ id: 'pipeline' })).toMatchObject({ success: false }); expect(m.sync).not.toHaveBeenCalled();
  });
  it('acknowledging differences preserves the audit before clearing the visible list', async () => {
    expect(await acknowledgeArivePipelineConflicts({ id: 'pipeline' })).toMatchObject({ success: true });
    expect(m.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PROCESSING_ARIVE_CONFLICTS_ACKNOWLEDGED', details: expect.stringContaining('titleStatus') }) }));
    expect(m.db.arivePipelineSync.update).toHaveBeenCalledWith({ where: { id: 'sync' }, data: { conflicts: [] } });
    expect(m.sync).not.toHaveBeenCalled();
  });
});
