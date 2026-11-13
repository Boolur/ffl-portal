import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), row: vi.fn(), sync: vi.fn(), update: vi.fn(), count: vi.fn(), control: vi.fn(), controlWrite: vi.fn(), audit: vi.fn(), transaction: vi.fn(), lock: vi.fn(), api: vi.fn(), apiSession: vi.fn(), budget: vi.fn(), quota: vi.fn(), practice: vi.fn(), practiceWrite: vi.fn(), existingLoan: vi.fn(), existingLink: vi.fn(), metrics: vi.fn(), worker: vi.fn(), probe: vi.fn(), recentProbe: vi.fn(), candidates: vi.fn(), candidateCounts: vi.fn(), testLoan: vi.fn(), practiceList: vi.fn() }));
const errors = vi.hoisted(() => ({ AriveError: class AriveError extends Error {} }));
const timing = vi.hoisted(() => ({ sample: vi.fn(), activeCount: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: m.user }, processingPipelineLoan: { findUnique: m.row, findMany: m.candidates, groupBy: m.candidateCounts, findFirst: m.testLoan, count: timing.activeCount }, arivePracticeLoan: { findMany: m.practiceList }, arivePipelineSync: { findUnique: m.sync, findFirst: m.existingLink, update: m.update, count: m.count }, auditLog: { create: m.audit }, $transaction: m.transaction } }));
vi.mock('@/lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, ariveSession: m.probe, AriveError: errors.AriveError }));
vi.mock('@/lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget, configureAriveTransportQuota: m.quota, getAriveTransportMetrics: m.metrics, sharedAriveTransportEnabled: () => process.env.ARIVE_SHARED_TRANSPORT_ENABLED === 'true' }));
vi.mock('@/lib/ariveRolloutWorker', () => ({ syncAriveRolloutLoan: m.worker }));
vi.mock('@/lib/ariveReadTiming', () => ({ sampleAriveTestReadTiming: timing.sample }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveTransport', async () => import('../../lib/ariveTransport'));
vi.mock('@/lib/ariveSyncState', async () => import('../../lib/ariveSyncState'));
vi.mock('@/lib/ariveSyncTypes', async () => import('../../lib/ariveSyncTypes'));
vi.mock('@/lib/ariveRollout', async () => import('../../lib/ariveRollout'));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, AriveError: errors.AriveError }));
vi.mock('../../lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget }));
import { acknowledgeAriveRolloutConflicts, configureAriveRollout, getAriveRolloutInventory, inspectAriveReportedAllowance, measureAriveTestReadTiming, queueAriveRolloutRefresh, registerPracticeAriveLoan, setAriveRolloutLoanEnabled, transferLegacyAriveRolloutFile } from './ariveRolloutActions';

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
  vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'false');
  m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III' } }); m.user.mockResolvedValue({ id: 'admin', active: true, role: 'ADMIN_III', roles: [] });
  m.row.mockImplementation(async () => structuredClone({ ...state.row, ariveSync: state.sync })); m.sync.mockImplementation(async () => structuredClone(state.sync));
  m.control.mockImplementation(async () => structuredClone(state.control)); m.count.mockResolvedValue(0); m.budget.mockResolvedValue({ ready: true, reason: null });
  m.practice.mockImplementation(async () => state.practice ? { ariveLoanId: '99999123' } : null); m.existingLink.mockImplementation(async () => state.linked ? { id: 'linked' } : null); m.existingLoan.mockImplementation(async () => state.existingLoan ? { id: 'existing' } : null);
  m.apiSession.mockResolvedValue(m.api); m.api.mockResolvedValue({ ariveLoanId: 99999123, sysGUID: 'remote-guid', loanOriginatorEmail: 'owner@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }] });
  m.worker.mockResolvedValue({ success: true, skipped: true }); m.recentProbe.mockResolvedValue(null);
  m.candidates.mockResolvedValue([]); m.candidateCounts.mockResolvedValue([]); m.practiceList.mockResolvedValue([]); m.testLoan.mockResolvedValue(null);
  m.probe.mockImplementation(async (_credentials, observe) => { observe?.(new Headers(), 'API request'); return m.api; });
  timing.activeCount.mockResolvedValue(409);
  timing.sample.mockResolvedValue({ success: true, completedRequests: 12, completedCycles: 3, meanCycleApiMs: 1200, error: null });
  m.transaction.mockImplementation(async work => work({ $executeRaw: m.lock, processingPipelineLoan: { findUnique: m.row }, arivePipelineSync: { findUnique: m.sync, update: m.update, count: m.count, findFirst: m.existingLink }, ariveRolloutControl: { findUnique: m.control, upsert: m.controlWrite }, arivePracticeLoan: { findFirst: m.practice, upsert: m.practiceWrite }, loan: { findUnique: m.existingLoan }, auditLog: { create: m.audit, findFirst: m.recentProbe } }));
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
  it('durably queues, attempts the shared worker and deduplicates an existing queue entry', async () => {
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true, queued: true });
    expect(m.update.mock.calls[0][0].data).toHaveProperty('manualRefreshRequestedAt'); expect(m.apiSession).not.toHaveBeenCalled(); expect(m.worker).toHaveBeenCalledWith('pipeline-test');
    state.sync.manualRefreshRequestedAt = new Date(); m.update.mockClear(); await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' }); expect(m.update).not.toHaveBeenCalled();
  });
  it.each([true, false])('reports a completed shared refresh accurately (apply=%s)', async applied => {
    m.worker.mockResolvedValue({ success: true, skipped: false, applied, changed: applied });
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true, queued: false, applied, collected: !applied });
  });
  it('keeps a deferred refresh queued and reports a failed read without claiming success', async () => {
    m.worker.mockResolvedValue({ success: false, error: 'Budget is busy', deferred: true });
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true, queued: true });
    m.worker.mockResolvedValue({ success: false, error: 'Incomplete read', deferred: false });
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: false, error: 'Incomplete read' });
  });
  it('accepts a durable manual request during provider cooldown without starting a worker', async () => {
    m.budget.mockResolvedValue({ ready: true, reason: null, cooldownUntil: new Date('2099-01-01') });
    expect(await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true, queued: true });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ manualRefreshRequestedAt: expect.any(Date) }) }));
    expect(m.worker).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
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

describe('rollout inventory and bounded allowance diagnostics', () => {
  it('returns only actual registered test files and paginates eligible portal loans', async () => {
    m.candidates.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ id: `pipeline-${i}`, sheet: 'PIPELINE', loan: { loanNumber: String(i), borrowerName: 'Synthetic Borrower' }, ariveSync: null })));
    m.candidateCounts.mockResolvedValue([{ sheet: 'PIPELINE', _count: { _all: 307 } }]);
    m.testLoan.mockResolvedValue({ id: 'legacy', loan: { borrowerName: 'TESTING TESTER' }, ariveSync: { ariveGuid: 'guid', enabled: true, workerOwner: 'LEGACY' } });
    m.practiceList.mockResolvedValue([{ ariveLoanId: '999', label: 'Practice only', ariveGuid: null, enabled: true }]);
    const result = await getAriveRolloutInventory();
    expect(result).toMatchObject({ success: true, nextCursor: 'pipeline-49', counts: [{ sheet: 'PIPELINE', count: 307 }], tests: [{ kind: 'LEGACY', pipelineId: 'legacy' }, { kind: 'PRACTICE', pipelineId: null }] });
    if (result.success) expect(result.candidates).toHaveLength(50);
    expect(m.apiSession).not.toHaveBeenCalled(); expect(m.probe).not.toHaveBeenCalled();
  });
  it('does not retain authorized access after account revocation', async () => {
    m.user.mockResolvedValue({ id: 'admin', active: false, role: 'ADMIN_III', roles: [] });
    for (const action of [() => getAriveRolloutInventory(), () => inspectAriveReportedAllowance(), () => measureAriveTestReadTiming(), () => acknowledgeAriveRolloutConflicts({ pipelineId: 'pipeline-test' })]) expect((await action()).success).toBe(false);
    expect(m.candidates).not.toHaveBeenCalled(); expect(m.probe).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each(['600', '', '0', 'unknown', '600/60', '999999999'])('accepts only a usable documented limit header (%s)', async limit => {
    m.existingLink.mockResolvedValue({ ariveGuid: 'known-test-guid' });
    m.probe.mockImplementation(async (_credentials, observe) => { observe(new Headers({ 'x-ratelimit-limit': limit, 'x-ratelimit-remaining': '500', authorization: 'never-return-me' }), 'API request'); return m.api; });
    const result = await inspectAriveReportedAllowance();
    expect(result).toMatchObject({ success: true, providerRequestLimit: limit === '600' ? 600 : null, providerWindowSeconds: 60 });
    expect(m.api).toHaveBeenCalledWith('/loans/known-test-guid'); expect(m.api).toHaveBeenCalledOnce();
    expect(m.quota).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('never-return-me');
  });
  it('does not substitute an authentication-header limit for the loan API limit', async () => {
    m.existingLink.mockResolvedValue({ ariveGuid: 'known-test-guid' });
    m.probe.mockImplementation(async (_credentials, observe) => { observe(new Headers({ 'x-ratelimit-limit': '600' }), 'authentication'); return m.api; });
    expect(await inspectAriveReportedAllowance()).toMatchObject({ success: true, providerRequestLimit: null });
  });
  it('serializes repeated probes and refuses them before any provider request', async () => {
    m.existingLink.mockResolvedValue({ ariveGuid: 'known-test-guid' }); m.recentProbe.mockResolvedValue({ id: 'recent' });
    expect(await inspectAriveReportedAllowance()).toMatchObject({ success: false, error: expect.stringContaining('one minute') });
    expect(m.probe).not.toHaveBeenCalled(); expect(m.lock).toHaveBeenCalled();
  });
  it('times only the known test file and makes no quota, enrollment or loan mutation', async () => {
    m.existingLink.mockResolvedValue({ ariveGuid: 'known-test-guid' });
    expect(await measureAriveTestReadTiming()).toMatchObject({ success: true, timing: { completedRequests: 12, activeLoans: 409, apiOnlySweepEstimateSeconds: 246 } });
    expect(timing.sample).toHaveBeenCalledWith(m.api, 'known-test-guid');
    expect(m.quota).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.controlWrite).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ARIVE_READ_TIMING_COMPLETED' }) }));
  });
  it('blocks repeated timing runs before authentication or API calls', async () => {
    m.existingLink.mockResolvedValue({ ariveGuid: 'known-test-guid' }); m.recentProbe.mockResolvedValue({ id: 'recent' });
    expect(await measureAriveTestReadTiming()).toMatchObject({ success: false, error: expect.stringContaining('ten minutes') });
    expect(m.probe).not.toHaveBeenCalled(); expect(timing.sample).not.toHaveBeenCalled();
  });
  it('does not run the legacy bounded diagnostic after shared collection is activated', async () => {
    vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'true');
    expect(await measureAriveTestReadTiming()).toMatchObject({ success: false, error: expect.stringContaining('before shared synchronization') });
    expect(m.probe).not.toHaveBeenCalled(); expect(timing.sample).not.toHaveBeenCalled();
  });
  it('keeps acknowledged conflicts in the audit history and never changes loan values', async () => {
    expect(await acknowledgeAriveRolloutConflicts({ pipelineId: 'pipeline-test' })).toMatchObject({ success: true });
    expect(m.update).toHaveBeenCalledWith({ where: { pipelineId: 'pipeline-test' }, data: { conflicts: [] } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'ARIVE_ROLLOUT_CONFLICTS_ACKNOWLEDGED', loanId: 'loan-test' }) }));
    state.sync.workerOwner = 'LEGACY'; m.update.mockClear();
    expect((await acknowledgeAriveRolloutConflicts({ pipelineId: 'pipeline-test' })).success).toBe(false); expect(m.update).not.toHaveBeenCalled();
  });
});
