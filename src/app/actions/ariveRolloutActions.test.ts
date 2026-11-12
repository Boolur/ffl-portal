import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), row: vi.fn(), sync: vi.fn(), update: vi.fn(), count: vi.fn(), control: vi.fn(), controlWrite: vi.fn(), audit: vi.fn(), transaction: vi.fn(), lock: vi.fn(), api: vi.fn(), apiSession: vi.fn(), budget: vi.fn(), quota: vi.fn(), practice: vi.fn(), practiceWrite: vi.fn(), existingLoan: vi.fn(), existingLink: vi.fn(), metrics: vi.fn() }));
const errors = vi.hoisted(() => ({ AriveError: class AriveError extends Error {} }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: m.user }, processingPipelineLoan: { findUnique: m.row }, arivePipelineSync: { findUnique: m.sync, update: m.update, count: m.count }, auditLog: { create: m.audit }, $transaction: m.transaction } }));
vi.mock('@/lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, AriveError: errors.AriveError }));
vi.mock('@/lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget, configureAriveTransportQuota: m.quota, getAriveTransportMetrics: m.metrics }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveTransport', async () => import('../../lib/ariveTransport'));
vi.mock('@/lib/ariveSyncState', async () => import('../../lib/ariveSyncState'));
vi.mock('@/lib/ariveRollout', async () => import('../../lib/ariveRollout'));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, AriveError: errors.AriveError }));
vi.mock('../../lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget }));
import { configureAriveRollout, queueAriveRolloutRefresh, registerPracticeAriveLoan, setAriveRolloutLoanEnabled, transferLegacyAriveRolloutFile } from './ariveRolloutActions';

let state: ReturnType<typeof initial>;
function initial() {
  return {
    row: { id: 'pipeline-test', loanId: 'loan-test', version: 2, sheet: 'PIPELINE', fundedAt: null,
      loan: { id: 'loan-test', loanNumber: '99999123', borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower', loanOfficer: { email: 'owner@example.test' }, secondaryLoanOfficer: null, payrollCompRequests: [] } },
    sync: { pipelineId: 'pipeline-test', enabled: true, enabledById: 'admin', workerOwner: 'GENERALIZED', workerGeneration: 1,
      ariveLoanId: '99999123', ariveGuid: 'remote-guid', verifiedOriginatorEmail: 'owner@example.test', enrollmentStatus: 'VERIFIED',
      snapshot: { source: { stage: 'APPLICATION_INTAKE' }, managed: { sheet: 'PIPELINE' } }, everFunded: false, manualRefreshRequestedAt: null as Date | null,
      leaseToken: 'in-flight-old-worker', leaseUntil: new Date('2099-01-01'), pipeline: { loanId: 'loan-test' } },
    control: { collectionEnabled: true, applicationEnabled: false, enrollmentEnabled: true, cohortLimit: 10 as number | null },
    practice: false, linked: false, existingLoan: false,
  };
}
beforeEach(() => {
  vi.clearAllMocks(); state = initial();
  vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III' } }); m.user.mockResolvedValue({ id: 'admin', active: true, role: 'ADMIN_III', roles: [] });
  m.row.mockImplementation(async () => structuredClone({ ...state.row, ariveSync: state.sync })); m.sync.mockImplementation(async () => structuredClone(state.sync));
  m.control.mockImplementation(async () => structuredClone(state.control)); m.count.mockResolvedValue(0); m.budget.mockResolvedValue({ ready: true, reason: null });
  m.practice.mockImplementation(async () => state.practice ? { ariveLoanId: '99999123' } : null); m.existingLink.mockImplementation(async () => state.linked ? { id: 'linked' } : null); m.existingLoan.mockImplementation(async () => state.existingLoan ? { id: 'existing' } : null);
  m.apiSession.mockResolvedValue(m.api); m.api.mockResolvedValue({ ariveLoanId: 99999123, sysGUID: 'remote-guid', loanOriginatorEmail: 'owner@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }] });
  m.transaction.mockImplementation(async work => work({ $executeRaw: m.lock, processingPipelineLoan: { findUnique: m.row }, arivePipelineSync: { findUnique: m.sync, update: m.update, count: m.count, findFirst: m.existingLink }, ariveRolloutControl: { findUnique: m.control, upsert: m.controlWrite }, arivePracticeLoan: { findFirst: m.practice, upsert: m.practiceWrite }, loan: { findUnique: m.existingLoan }, auditLog: { create: m.audit } }));
});
afterEach(() => vi.unstubAllEnvs());

describe('rollout control authentication and canonical isolation', () => {
  it.each(['signed out', 'inactive', 'forged role', 'lower admin', 'wrong active role', 'preview'])('blocks %s before reads or mutations', async scenario => {
    if (scenario === 'signed out') m.session.mockResolvedValue(null);
    if (scenario === 'inactive') m.user.mockResolvedValue({ id: 'admin', active: false, role: 'ADMIN_III', roles: [] });
    if (scenario === 'forged role') m.user.mockResolvedValue({ id: 'admin', active: true, role: 'LOAN_OFFICER', roles: [] });
    if (scenario === 'lower admin') m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_II' } });
    if (scenario === 'wrong active role') m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III', activeRole: 'LOAN_OFFICER' } });
    if (scenario === 'preview') vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).success).toBe(false); expect(m.transaction).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
  });
  it('fails closed without quota confirmation and allows stopping a rollout even when its environment gate is off', async () => {
    m.budget.mockResolvedValue({ ready: false, reason: 'Confirm allowance' });
    expect(await configureAriveRollout({ collectionEnabled: true, applicationEnabled: true, enrollmentEnabled: true })).toMatchObject({ success: false, error: 'Confirm allowance' });
    vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); expect(await configureAriveRollout({ collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false })).toMatchObject({ success: true });
  });
  it('accepts only named settings and cannot lower the cohort below enabled membership', async () => {
    const input = { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, id: 'untrusted', generation: 1000, enrollmentCursor: 'untrusted' };
    expect(await configureAriveRollout(input)).toMatchObject({ success: true });
    expect(m.controlWrite.mock.calls[0][0].create).toEqual(expect.objectContaining({ id: 'company', generation: 1 })); expect(m.controlWrite.mock.calls[0][0].create).not.toHaveProperty('enrollmentCursor');
    m.count.mockResolvedValue(11); expect((await configureAriveRollout({ collectionEnabled: true, applicationEnabled: false, enrollmentEnabled: true, cohortLimit: 10 })).success).toBe(false);
  });
  it('queues a refresh without making an immediate request and deduplicates an existing queue entry', async () => {
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true, queued: true });
    expect(m.update.mock.calls[0][0].data).toHaveProperty('manualRefreshRequestedAt'); expect(m.apiSession).not.toHaveBeenCalled();
    state.sync.manualRefreshRequestedAt = new Date(); m.update.mockClear(); await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' }); expect(m.update).not.toHaveBeenCalled();
  });
  it('cannot use generalized enable/pause controls on legacy records', async () => {
    state.sync.workerOwner = 'LEGACY'; expect((await setAriveRolloutLoanEnabled({ pipelineId: 'pipeline-test', enabled: false })).success).toBe(false); expect(m.update).not.toHaveBeenCalled();
  });
  it('operator pause cancels the lease but preserves provenance generation for a later unchanged resume', async () => {
    expect(await setAriveRolloutLoanEnabled({ pipelineId: 'pipeline-test', enabled: false })).toMatchObject({ success: true });
    const data = m.update.mock.calls[0][0].data; expect(data).toMatchObject({ enabled: false, operatorPaused: true, leaseToken: null, leaseUntil: null }); expect(data).not.toHaveProperty('workerGeneration');
  });
  it('hands off only worker ownership and fences the old lease while preserving documents/snapshots', async () => {
    state.sync.workerOwner = 'LEGACY'; expect(await transferLegacyAriveRolloutFile({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true });
    const data = m.update.mock.calls[0][0].data; expect(data).toMatchObject({ workerOwner: 'GENERALIZED', workerGeneration: { increment: 1 }, leaseToken: null, leaseUntil: null, enrollmentStatus: 'VERIFIED' });
    for (const field of ['snapshot', 'conflicts', 'fieldSources', 'submissionData', 'enabled']) expect(data).not.toHaveProperty(field);
    expect(m.api.mock.calls.every(call => call.length === 1)).toBe(true); expect(m.audit.mock.calls[0][0].data.action).toBe('ARIVE_ROLLOUT_LEGACY_HANDOFF');
  });
  it('does not hand off a file changed during remote verification', async () => {
    state.sync.workerOwner = 'LEGACY'; m.api.mockImplementation(async () => { state.row.version++; return { ariveLoanId: 99999123, sysGUID: 'remote-guid', loanOriginatorEmail: 'owner@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }] }; });
    expect((await transferLegacyAriveRolloutFile({ pipelineId: 'pipeline-test' })).success).toBe(false); expect(m.update).not.toHaveBeenCalled();
  });
  it.each(['canonical link', 'unenrolled real loan'])('cannot register a practice ID belonging to %s', async kind => {
    if (kind === 'canonical link') state.linked = true; else state.existingLoan = true;
    expect((await registerPracticeAriveLoan({ ariveLoanId: '99999123', label: 'Synthetic practice' })).success).toBe(false); expect(m.practiceWrite).not.toHaveBeenCalled();
  });
  it('registers only local exclusion metadata and makes no remote request or synthetic Loan', async () => {
    expect(await registerPracticeAriveLoan({ ariveLoanId: '99999123', label: 'Synthetic practice' })).toMatchObject({ success: true }); expect(m.practiceWrite).toHaveBeenCalledOnce(); expect(m.apiSession).not.toHaveBeenCalled(); expect(m.lock).toHaveBeenCalled();
  });
});
