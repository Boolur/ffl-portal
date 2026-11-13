import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), row: vi.fn(), sync: vi.fn(), update: vi.fn(), count: vi.fn(), control: vi.fn(), controlWrite: vi.fn(), audit: vi.fn(), transaction: vi.fn(), lock: vi.fn(), api: vi.fn(), apiSession: vi.fn(), budget: vi.fn(), quota: vi.fn(), practice: vi.fn(), practiceWrite: vi.fn(), existingLoan: vi.fn(), existingLink: vi.fn(), metrics: vi.fn(), worker: vi.fn(), probe: vi.fn(), recentProbe: vi.fn(), candidates: vi.fn(), candidateCounts: vi.fn(), testLoan: vi.fn(), practiceList: vi.fn() }));
const errors = vi.hoisted(() => ({ AriveError: class AriveError extends Error {} }));
const timing = vi.hoisted(() => ({ sample: vi.fn(), activeCount: vi.fn() }));
const operatorBudget = vi.hoisted(() => ({ configure: vi.fn() }));
const cohort = vi.hoisted(() => ({ queue: vi.fn() }));
const visibility = vi.hoisted(() => ({ users: vi.fn() }));
const access = vi.hoisted(() => ({ compare: vi.fn() }));
const impact = vi.hoisted(() => ({ events: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: m.user, findMany: visibility.users }, processingPipelineLoan: { findUnique: m.row, findMany: m.candidates, groupBy: m.candidateCounts, findFirst: m.testLoan, count: timing.activeCount }, arivePracticeLoan: { findMany: m.practiceList }, arivePipelineSync: { findUnique: m.sync, findFirst: m.existingLink, update: m.update, count: m.count }, auditLog: { create: m.audit, findMany: impact.events }, $transaction: m.transaction } }));
vi.mock('@/lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, ariveSession: m.probe, AriveError: errors.AriveError }));
vi.mock('@/lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget, configureAriveTransportQuota: m.quota, configureAriveOperatorBudget: operatorBudget.configure, getAriveTransportMetrics: m.metrics, sharedAriveTransportEnabled: () => process.env.ARIVE_SHARED_TRANSPORT_ENABLED === 'true' }));
vi.mock('@/lib/ariveRolloutWorker', () => ({ syncAriveRolloutLoan: m.worker }));
vi.mock('@/lib/ariveReadTiming', () => ({ sampleAriveTestReadTiming: timing.sample }));
vi.mock('@/lib/ariveLoanAccessDiagnostic', () => ({ compareSavedAriveLoanAccess: access.compare }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveTransport', async () => import('../../lib/ariveTransport'));
vi.mock('@/lib/ariveSyncState', async () => import('../../lib/ariveSyncState'));
vi.mock('@/lib/ariveSyncTypes', async () => import('../../lib/ariveSyncTypes'));
vi.mock('@/lib/ariveRollout', async () => import('../../lib/ariveRollout'));
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/ariveClient', () => ({ ariveReadOnlySession: m.apiSession, AriveError: errors.AriveError }));
vi.mock('../../lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget }));
import { acknowledgeAriveRolloutConflicts, compareAriveLoanAccess, configureAriveRollout, configureAriveRolloutOperatorBudget, emergencyContainAriveRollout, getAriveRolloutImpact, getAriveRolloutInventory, inspectAriveAccessibleLoanCount, inspectAriveLoanCoverage, inspectAriveReportedAllowance, measureAriveTestReadTiming, queueAriveRolloutCohortRefresh, queueAriveRolloutRefresh, registerPracticeAriveLoan, setAriveRolloutLoanEnabled, transferLegacyAriveRolloutFile } from './ariveRolloutActions';

let state: ReturnType<typeof initial>;
function initial() {
  return {
    row: { id: 'pipeline-test', loanId: 'loan-test', version: 2, sheet: 'PIPELINE', fundedAt: null,
      loan: { id: 'loan-test', loanNumber: '99999123', borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower', loanOfficer: { email: 'owner@example.test' }, secondaryLoanOfficer: null, payrollCompRequests: [] } },
    sync: { pipelineId: 'pipeline-test', enabled: true, enabledById: 'admin', workerOwner: 'GENERALIZED', workerGeneration: 1,
      ariveLoanId: '99999123', ariveGuid: 'remote-guid', verifiedOriginatorEmail: 'owner@example.test', enrollmentStatus: 'VERIFIED',
      snapshot: { source: { stage: 'APPLICATION_INTAKE' }, managed: { sheet: 'PIPELINE' } }, everFunded: false, manualRefreshRequestedAt: null as Date | null,
      leaseToken: 'in-flight-old-worker', leaseUntil: new Date('2099-01-01'), pipeline: { loanId: 'loan-test' } },
    control: { collectionEnabled: true, applicationEnabled: false, enrollmentEnabled: true, cohortLimit: 10 as number | null, enabledById: 'admin' as string | null },
    practice: false, linked: false, existingLoan: false,
  };
}
beforeEach(() => {
  vi.clearAllMocks(); state = initial();
  vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('CRON_SECRET', 'synthetic-cron');
  vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', 'true');
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
  operatorBudget.configure.mockResolvedValue({ enabled: true, allowance: 120, windowSeconds: 60, deploymentActive: false, allowanceSource: 'OPERATOR_AUTHORIZED' });
  cohort.queue.mockResolvedValue({ count: 10 });
  visibility.users.mockResolvedValue([]);
  impact.events.mockResolvedValue([]);
  access.compare.mockResolvedValue({ steps: [], partial: false, checkedAt: '2026-11-13T01:00:00Z', limitations: 'No enrollment changes.', getRequests: 6, authenticationRequests: 1 });
  m.transaction.mockImplementation(async work => work({ $executeRaw: m.lock, processingPipelineLoan: { findUnique: m.row }, arivePipelineSync: { findUnique: m.sync, update: m.update, updateMany: cohort.queue, count: m.count, findFirst: m.existingLink }, ariveRolloutControl: { findUnique: m.control, upsert: m.controlWrite }, arivePracticeLoan: { findFirst: m.practice, upsert: m.practiceWrite }, loan: { findUnique: m.existingLoan }, auditLog: { create: m.audit, findFirst: m.recentProbe } }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('rollout control authentication and canonical isolation', () => {
  it.each(['signed out', 'inactive', 'forged role', 'lower admin', 'wrong active role', 'preview'])('blocks %s before reads or mutations', async scenario => {
    if (scenario === 'signed out') m.session.mockResolvedValue(null);
    if (scenario === 'inactive') m.user.mockResolvedValue({ id: 'admin', active: false, role: 'ADMIN_III', roles: [] });
    if (scenario === 'forged role') m.user.mockResolvedValue({ id: 'admin', active: true, role: 'LOAN_OFFICER', roles: [] });
    if (scenario === 'lower admin') m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_II' } });
    if (scenario === 'wrong active role') m.session.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN_III', activeRole: 'LOAN_OFFICER' } });
    if (scenario === 'preview') vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await queueAriveRolloutRefresh({ pipelineId: 'pipeline-test' })).success).toBe(false);
    expect((await queueAriveRolloutCohortRefresh()).success).toBe(false);
    expect((await inspectAriveAccessibleLoanCount()).success).toBe(false);
    expect((await inspectAriveLoanCoverage()).success).toBe(false);
    expect((await compareAriveLoanAccess({ loanNumber: '99999123' })).success).toBe(false);
    expect((await configureAriveRolloutOperatorBudget({ requestsPerMinute: 120, enabled: true })).success).toBe(false);
    expect((await emergencyContainAriveRollout()).success).toBe(false);
    expect((await getAriveRolloutImpact()).success).toBe(false);
    expect(impact.events).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled(); expect(operatorBudget.configure).not.toHaveBeenCalled();
  });
  it('records operator authorization from the current account without claiming provider confirmation', async () => {
    const input = { requestsPerMinute: 120, enabled: true, authorizedById: 'forged-user', providerConfirmed: true, providerRequestLimit: 10000 };
    expect(await configureAriveRolloutOperatorBudget(input)).toMatchObject({ success: true, result: { allowanceSource: 'OPERATOR_AUTHORIZED', allowance: 120 } });
    expect(operatorBudget.configure).toHaveBeenCalledWith({ requestsPerMinute: 120, enabled: true, authorizedById: 'admin' });
    expect(m.quota).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled(); expect(m.controlWrite).not.toHaveBeenCalled();
    const audit = m.audit.mock.calls.at(-1)?.[0].data;
    expect(audit).toMatchObject({ userId: 'admin', action: 'ARIVE_OPERATOR_BUDGET_AUTHORIZED' });
    expect(JSON.parse(audit.details)).toEqual({ requestsPerMinute: 120, enabled: true, allowanceSource: 'OPERATOR_AUTHORIZED', providerConfirmed: false });
  });
  it.each([9, 601, 10.5, NaN, Infinity])('rejects an invalid operator cap (%s) before configuration', async requestsPerMinute => {
    expect((await configureAriveRolloutOperatorBudget({ requestsPerMinute, enabled: true })).success).toBe(false);
    expect(operatorBudget.configure).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it('allows disabling operator requests without enabling collection', async () => {
    expect((await configureAriveRolloutOperatorBudget({ requestsPerMinute: 120, enabled: false })).success).toBe(true);
    expect(operatorBudget.configure).toHaveBeenCalledWith({ requestsPerMinute: 120, enabled: false, authorizedById: 'admin' });
    expect(m.controlWrite).not.toHaveBeenCalled();
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

describe('emergency rollout containment and historical impact', () => {
  it('atomically stops all generalized work without credentials, gates, or changing any loan values', async () => {
    vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', 'false');
    m.budget.mockResolvedValue({ ready: false, reason: 'Unavailable' });
    expect(await emergencyContainAriveRollout()).toEqual({ success: true, disabledCount: 10 });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.lock.mock.calls[0][0].join('')).toContain('arive-rollout:company');
    expect(m.controlWrite).toHaveBeenCalledWith({ where: { id: 'company' },
      create: { id: 'company', collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, enabledById: 'admin', generation: 1 },
      update: { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, enabledById: 'admin', generation: { increment: 1 } } });
    expect(cohort.queue).toHaveBeenCalledWith({ where: { workerOwner: 'GENERALIZED', enabled: true },
      data: { enabled: false, operatorPaused: true, leaseToken: null, leaseUntil: null, manualRefreshRequestedAt: null, nextAttemptAt: null } });
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.controlWrite.mock.invocationCallOrder[0]);
    expect(m.controlWrite.mock.invocationCallOrder[0]).toBeLessThan(cohort.queue.mock.invocationCallOrder[0]);
    expect(cohort.queue.mock.invocationCallOrder[0]).toBeLessThan(m.audit.mock.invocationCallOrder[0]);
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: 'admin', action: 'ARIVE_ROLLOUT_EMERGENCY_CONTAINED' });
    expect(JSON.parse(m.audit.mock.calls[0][0].data.details)).toMatchObject({ disabledCount: 10, appliedValuesPreserved: true, workerOwner: 'GENERALIZED' });
    expect(m.row).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(m.budget).not.toHaveBeenCalled();
    expect(m.apiSession).not.toHaveBeenCalled(); expect(m.worker).not.toHaveBeenCalled(); expect(m.quota).not.toHaveBeenCalled();
    for (const field of ['snapshot', 'collectedSnapshot', 'workerGeneration', 'routingProvenance', 'conflicts', 'fieldSources']) expect(cohort.queue.mock.calls[0][0].data).not.toHaveProperty(field);
  });
  it('repeated containment reports zero newly disabled files without reenabling any records', async () => {
    cohort.queue.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce({ count: 0 });
    expect(await emergencyContainAriveRollout()).toMatchObject({ disabledCount: 10 });
    expect(await emergencyContainAriveRollout()).toMatchObject({ disabledCount: 0 });
    for (const [request] of cohort.queue.mock.calls) expect(request.where).toEqual({ workerOwner: 'GENERALIZED', enabled: true });
    expect(JSON.parse(m.audit.mock.calls.at(-1)![0].data.details).disabledCount).toBe(0);
  });
  it('fails the atomic action if its audit cannot be written', async () => {
    m.audit.mockRejectedValueOnce(new Error('private persistence failure'));
    expect(await emergencyContainAriveRollout()).toEqual({ success: false, error: 'The Arive rollout operation could not be completed.' });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.transaction.mock.calls[0][1]).toEqual({ maxWait: 10_000, timeout: 20_000 });
  });
  it('blocks live application by default without blocking preview collection', async () => {
    vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', '');
    expect(await configureAriveRollout({ collectionEnabled: true, applicationEnabled: true, enrollmentEnabled: true })).toMatchObject({ success: false, error: expect.stringContaining('Live Arive application is disabled') });
    expect(m.transaction).not.toHaveBeenCalled();
    expect(await configureAriveRollout({ collectionEnabled: true, applicationEnabled: false, enrollmentEnabled: true })).toMatchObject({ success: true });
  });
  it('counts distinct real, synthetic and unknown files from generalized change history while paused', async () => {
    vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); state.control.collectionEnabled = false;
    const event = (pipelineId: string, loanId: string | null, number: string | null, changed: boolean, worker = 'GENERALIZED') => ({ id: pipelineId, loanId, loan: number ? { loanNumber: number } : null,
      details: JSON.stringify({ pipelineId, worker, changes: changed ? [{ field: 'titleStatus', previous: 'private previous', next: 'private next' }] : [] }), createdAt: new Date() });
    m.practiceList.mockResolvedValue([{ ariveLoanId: '77777' }]);
    impact.events.mockResolvedValue([
      event('real-one', 'loan-one', '11111', true), event('real-one', 'loan-one', '11111', true),
      event('real-two', 'loan-two', '22222', false), event('test-known', 'loan-test', '17881588', true),
      event('test-practice', 'loan-practice', '77777', true), event('missing-loan', null, null, true),
      event('legacy', 'loan-legacy', '33333', true, 'LEGACY'),
    ]);
    const result = await getAriveRolloutImpact();
    expect(result).toMatchObject({ success: true, partial: false, applied: { real: 2, test: 2, unknown: 1 }, changed: { real: 1, test: 2, unknown: 1 }, changeEvents: 5, snapshotOnlyEvents: 1 });
    expect(impact.events.mock.calls[0][0]).toMatchObject({ where: { action: 'PROCESSING_ARIVE_SYNC_APPLIED', createdAt: { lte: expect.any(Date) } }, take: 10001 });
    expect(JSON.stringify(result)).not.toContain('private'); expect(JSON.stringify(result)).not.toContain('11111');
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled(); expect(m.budget).not.toHaveBeenCalled();
  });
  it('labels truncated or unreadable impact history as partial instead of an exact zero', async () => {
    impact.events.mockResolvedValue([{ id: 'bad', details: 'not JSON', loanId: null, loan: null }]);
    expect(await getAriveRolloutImpact()).toMatchObject({ success: true, partial: true, unreadableEvents: 1 });
    impact.events.mockResolvedValue(Array.from({ length: 10001 }, (_, index) => ({ id: String(index), details: '{}', loanId: null, loan: null })));
    expect(await getAriveRolloutImpact()).toMatchObject({ success: true, partial: true, inspectedEvents: 10000 });
  });
});

describe('durable cohort refresh requests', () => {
  it('queues only enabled verified company loans without resetting worker safeguards or making provider calls', async () => {
    expect(await queueAriveRolloutCohortRefresh()).toEqual({ success: true, queued: true, queuedCount: 10 });
    expect(m.budget).toHaveBeenCalledWith({ allowCooldown: true });
    expect(cohort.queue).toHaveBeenCalledWith({
      where: { enabled: true, workerOwner: 'GENERALIZED', enrollmentStatus: 'VERIFIED', connectionId: 'company', operatorPaused: false, manualRefreshRequestedAt: null },
      data: { manualRefreshRequestedAt: expect.any(Date) },
    });
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.control.mock.invocationCallOrder[0]);
    expect(m.control.mock.invocationCallOrder[0]).toBeLessThan(cohort.queue.mock.invocationCallOrder[0]);
    const audit = m.audit.mock.calls.at(-1)?.[0].data;
    expect(audit).toMatchObject({ userId: 'admin', action: 'ARIVE_ROLLOUT_COHORT_REFRESH_QUEUED' });
    expect(JSON.parse(audit.details)).toEqual({ queuedCount: 10 });
    expect(m.apiSession).not.toHaveBeenCalled(); expect(m.probe).not.toHaveBeenCalled(); expect(m.worker).not.toHaveBeenCalled();
    expect(m.controlWrite).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it('does not replace pending request timestamps on repeated clicks', async () => {
    cohort.queue.mockResolvedValueOnce({ count: 10 }).mockResolvedValueOnce({ count: 0 });
    expect(await queueAriveRolloutCohortRefresh()).toMatchObject({ queuedCount: 10 });
    expect(await queueAriveRolloutCohortRefresh()).toMatchObject({ queuedCount: 0 });
    for (const [request] of cohort.queue.mock.calls) expect(request.where.manualRefreshRequestedAt).toBeNull();
    expect(JSON.parse(m.audit.mock.calls.at(-1)?.[0].data.details)).toEqual({ queuedCount: 0 });
  });
  it('queues during a cooldown without invoking the worker or erasing delays', async () => {
    m.budget.mockResolvedValue({ ready: true, reason: null, cooldownUntil: new Date('2099-01-01') });
    expect(await queueAriveRolloutCohortRefresh()).toMatchObject({ success: true, queuedCount: 10 });
    expect(Object.keys(cohort.queue.mock.calls[0][0].data)).toEqual(['manualRefreshRequestedAt']);
    expect(m.worker).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
  });
  it.each(['deployment disabled', 'budget unavailable'])('refuses %s before queue mutation', async reason => {
    if (reason === 'deployment disabled') vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false');
    else m.budget.mockResolvedValue({ ready: false, reason: 'Shared budget unavailable' });
    expect((await queueAriveRolloutCohortRefresh()).success).toBe(false);
    expect(m.transaction).not.toHaveBeenCalled(); expect(cohort.queue).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(['collection paused', 'missing authorizer', 'deployment paused'])('rechecks %s after taking the rollout lock', async reason => {
    m.lock.mockImplementationOnce(async () => {
      if (reason === 'collection paused') state.control.collectionEnabled = false;
      if (reason === 'missing authorizer') state.control.enabledById = null;
      if (reason === 'deployment paused') vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false');
    });
    expect((await queueAriveRolloutCohortRefresh()).success).toBe(false);
    expect(m.control).toHaveBeenCalled(); expect(cohort.queue).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});

describe('saved connection loan coverage diagnostics', () => {
  it('checks one unfiltered page under the shared budget while collection is paused and returns only counts', async () => {
    state.control.collectionEnabled = false; state.control.enrollmentEnabled = false;
    vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false');
    m.api.mockResolvedValue({ count: 87, rows: [{ sysGUID: 'never-return-guid', ariveLoanId: 123456789, borrowerName: 'Never Return Borrower' }], secret: 'never-return-secret' });
    const result = await inspectAriveAccessibleLoanCount();
    expect(result).toEqual({ success: true, count: 87, returnedRowCount: 1, checkedAt: expect.any(String) });
    expect(m.budget).toHaveBeenCalledWith(); expect(m.apiSession).toHaveBeenCalledExactlyOnceWith();
    expect(m.api).toHaveBeenCalledExactlyOnceWith('/loans?limit=1&offset=0');
    expect(m.control).not.toHaveBeenCalled(); expect(m.controlWrite).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(cohort.queue).not.toHaveBeenCalled(); expect(m.quota).not.toHaveBeenCalled(); expect(operatorBudget.configure).not.toHaveBeenCalled();
    expect(m.lock.mock.invocationCallOrder[0]).toBeLessThan(m.recentProbe.mock.invocationCallOrder[0]);
    expect(m.audit.mock.invocationCallOrder[0]).toBeLessThan(m.apiSession.mock.invocationCallOrder[0]);
    const completed = m.audit.mock.calls.at(-1)?.[0].data;
    expect(completed).toMatchObject({ userId: 'admin', action: 'ARIVE_LOAN_COVERAGE_COMPLETED' });
    expect(JSON.parse(completed.details)).toEqual({ count: 87, returnedRowCount: 1, checkedAt: expect.any(String) });
    expect(JSON.stringify([result, m.audit.mock.calls])).not.toContain('never-return');
    expect(JSON.stringify([result, m.audit.mock.calls])).not.toContain('Never Return Borrower');
    expect(m.probe).not.toHaveBeenCalled();
  });
  it('accepts an empty accessible inventory without claiming a match', async () => {
    m.api.mockResolvedValue({ count: 0, rows: [] });
    expect(await inspectAriveAccessibleLoanCount()).toMatchObject({ success: true, count: 0, returnedRowCount: 0 });
  });
  it.each([
    { count: -1, rows: [] }, { count: 1.5, rows: [] }, { count: '1', rows: [] }, { count: Infinity, rows: [] },
    { count: Number.MAX_SAFE_INTEGER + 1, rows: [] }, { rows: [] }, { count: 1, rows: null }, { count: 1 },
    { count: 2, rows: [{}, {}] }, { count: 0, rows: [{}] }, null,
  ])('rejects malformed or excessive responses without persisting provider content: %j', async response => {
    m.api.mockResolvedValue(response);
    expect(await inspectAriveAccessibleLoanCount()).toMatchObject({ success: false, error: 'Arive returned an invalid loan coverage response. No coverage count was accepted.' });
    expect(m.audit).toHaveBeenCalledTimes(1);
    expect(m.audit.mock.calls[0][0].data.action).toBe('ARIVE_LOAN_COVERAGE_STARTED');
  });
  it('requires shared readiness and honors provider cooldown before the diagnostic starts', async () => {
    m.budget.mockResolvedValue({ ready: false, reason: 'Provider cooldown is active', cooldownUntil: new Date('2099-01-01') });
    expect(await inspectAriveAccessibleLoanCount()).toEqual({ success: false, error: 'Provider cooldown is active' });
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
  });
  it('serializes attempts across administrators and refuses repeats before any API call', async () => {
    m.recentProbe.mockResolvedValue({ id: 'recent-check' });
    expect(await inspectAriveAccessibleLoanCount()).toMatchObject({ success: false, error: expect.stringContaining('five minutes') });
    expect(m.recentProbe).toHaveBeenCalledWith({ where: { action: 'ARIVE_LOAN_COVERAGE_STARTED', createdAt: { gt: expect.any(Date) } }, select: { id: true } });
    expect(m.lock).toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
  });
  it('retains a started attempt when the provider fails, without treating it as successful coverage', async () => {
    m.api.mockRejectedValue(new errors.AriveError('Arive denied this read.'));
    expect(await inspectAriveAccessibleLoanCount()).toEqual({ success: false, error: 'Arive denied this read.' });
    expect(m.audit).toHaveBeenCalledTimes(1); expect(m.audit.mock.calls[0][0].data.action).toBe('ARIVE_LOAN_COVERAGE_STARTED');
  });
});

describe('bounded API loan visibility inspection', () => {
  const rows = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({ ariveLoanId: start + index, loanOriginatorEmail: ' Owner@Example.Test ', sysGUID: 'never-return-remote-guid', loanBorrowers: [{ firstName: 'Never Return Remote Borrower' }] }));
  it('paginates in creation order and returns only aggregate originators and exact existing portal overlaps', async () => {
    state.control.collectionEnabled = false; vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false');
    m.candidates.mockResolvedValue([
      { id: 'portal-one', sheet: 'PIPELINE', loan: { loanNumber: '1', borrowerName: 'Existing Portal One' } },
      { id: 'portal-last', sheet: 'FUNDING', loan: { loanNumber: '102', borrowerName: 'Existing Portal Last' } },
      { id: 'portal-other', sheet: 'RESTRUCTURE', loan: { loanNumber: '500', borrowerName: 'Not Accessible Portal Borrower' } },
    ]);
    visibility.users.mockResolvedValue([{ name: 'Portal Originator', email: 'OWNER@EXAMPLE.TEST' }]);
    m.api.mockResolvedValueOnce({ count: 102, rows: rows(1, 100) }).mockResolvedValueOnce({ count: 102, rows: rows(101, 2) });
    const result = await inspectAriveLoanCoverage();
    expect(result).toMatchObject({ success: true, complete: true, reportedCount: 102, scannedRows: 102, pagesRead: 2, partialReason: null, eligiblePortalCount: 3, portalMatchCount: 2,
      originators: [{ name: 'Portal Originator', email: 'owner@example.test', count: 102 }],
      matches: [{ pipelineId: 'portal-one', loanNumber: '1', borrowerName: 'Existing Portal One', sheet: 'PIPELINE' }, { pipelineId: 'portal-last', loanNumber: '102', borrowerName: 'Existing Portal Last', sheet: 'FUNDING' }],
    });
    expect(m.api.mock.calls).toEqual([['/loans?limit=100&offset=0&orderBy=createdAt&sort=ASC'], ['/loans?limit=100&offset=100&orderBy=createdAt&sort=ASC']]);
    expect(visibility.users).toHaveBeenCalledWith({ where: { email: { in: ['owner@example.test'], mode: 'insensitive' } }, select: { name: true, email: true } });
    expect(m.candidates.mock.calls[0][0]).toMatchObject({ where: { archivedAt: null }, select: { id: true, sheet: true, loan: { select: { loanNumber: true, borrowerName: true } } } });
    expect(JSON.stringify(result)).not.toContain('never-return'); expect(JSON.stringify(result)).not.toContain('Never Return Remote Borrower'); expect(JSON.stringify(result)).not.toContain('Not Accessible Portal Borrower');
    const audit = m.audit.mock.calls.at(-1)?.[0].data;
    expect(audit.action).toBe('ARIVE_LOAN_VISIBILITY_COMPLETED');
    expect(JSON.parse(audit.details)).toMatchObject({ complete: true, scannedRows: 102, portalMatchCount: 2 });
    for (const value of ['originators', 'matches', 'owner@example.test', 'Existing Portal', 'never-return']) expect(audit.details).not.toContain(value);
    expect(m.control).not.toHaveBeenCalled(); expect(m.controlWrite).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(cohort.queue).not.toHaveBeenCalled(); expect(m.quota).not.toHaveBeenCalled(); expect(operatorBudget.configure).not.toHaveBeenCalled(); expect(m.worker).not.toHaveBeenCalled(); expect(m.probe).not.toHaveBeenCalled();
  });
  it('completes an empty inventory in one page', async () => {
    m.api.mockResolvedValue({ count: 0, rows: [] });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: true, reportedCount: 0, scannedRows: 0, pagesRead: 1, originators: [], matches: [] });
    expect(m.api).toHaveBeenCalledTimes(1);
  });
  it('stops after ten pages and labels the retained 1000 rows as partial', async () => {
    m.api.mockImplementation(async (path: string) => { const offset = Number(new URL(path, 'https://example.test').searchParams.get('offset')); return { count: 1001, rows: rows(offset + 1, 100) }; });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ success: true, complete: false, reportedCount: 1001, scannedRows: 1000, pagesRead: 10, partialReason: expect.stringContaining('ten pages') });
    expect(m.api).toHaveBeenCalledTimes(10);
  });
  it('reserves 25 seconds before starting another page and retains only completed pages', async () => {
    let time = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => time);
    m.api.mockImplementation(async () => { time += 65_000; return { count: 200, rows: rows(1, 100) }; });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: false, scannedRows: 100, reportedCount: 200, partialReason: expect.stringContaining('time limit') });
    expect(m.api).toHaveBeenCalledTimes(1);
  });
  it('rejects count drift without combining the changed page into its aggregates', async () => {
    m.api.mockResolvedValueOnce({ count: 200, rows: rows(1, 100) }).mockResolvedValueOnce({ count: 201, rows: rows(101, 100) });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: false, reportedCount: 200, scannedRows: 100, partialReason: expect.stringContaining('count changed'), originators: [{ count: 100 }] });
  });
  it('discards every row of a malformed later page before deriving portal matches or originator aggregates', async () => {
    m.candidates.mockResolvedValue([{ id: 'portal-later', sheet: 'PIPELINE', loan: { loanNumber: '101', borrowerName: 'Must Not Appear' } }]);
    m.api.mockResolvedValueOnce({ count: 102, rows: rows(1, 100) }).mockResolvedValueOnce({ count: 102, rows: [{ ariveLoanId: 101, loanOriginatorEmail: 'later@example.test' }, { ariveLoanId: 'invalid', loanOriginatorEmail: 'later@example.test' }] });
    const result = await inspectAriveLoanCoverage();
    expect(result).toMatchObject({ complete: false, scannedRows: 100, matches: [], originators: [{ email: 'owner@example.test', count: 100 }] });
    expect(JSON.stringify(result)).not.toContain('later@example.test'); expect(JSON.stringify(result)).not.toContain('Must Not Appear');
  });
  it.each([
    { count: '1', rows: [] }, { count: -1, rows: [] }, { count: 1.5, rows: [] }, { count: Number.MAX_SAFE_INTEGER + 1, rows: [] },
    { count: 1, rows: null }, { count: 101, rows: rows(1, 101) }, null,
  ])('does not claim completeness for an invalid page: %j', async response => {
    m.api.mockResolvedValue(response);
    expect(await inspectAriveLoanCoverage()).toMatchObject({ success: true, complete: false, scannedRows: 0, partialReason: expect.stringContaining('invalid page'), matches: [], originators: [] });
    expect(m.api).toHaveBeenCalledTimes(1);
  });
  it.each([{ count: 101, rows: rows(1, 20) }, { count: 0, rows: rows(1, 1) }])('rejects short or excessive pagination without accepting rows: %j', async response => {
    m.api.mockResolvedValue(response);
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: false, scannedRows: 0, partialReason: expect.stringContaining('incomplete page') });
  });
  it.each([null, {}, { ariveLoanId: 'invalid' }, { ariveLoanId: 1.5 }])('rejects an invalid loan identity in a page: %j', async row => {
    m.api.mockResolvedValue({ count: 1, rows: [row] });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: false, scannedRows: 0, partialReason: expect.stringContaining('valid numeric loan number') });
  });
  it.each(['within page', 'across pages'])('rejects duplicate numeric loan IDs %s', async scenario => {
    if (scenario === 'within page') m.api.mockResolvedValue({ count: 2, rows: [{ ariveLoanId: 1 }, { ariveLoanId: '1' }] });
    else m.api.mockResolvedValueOnce({ count: 101, rows: rows(1, 100) }).mockResolvedValueOnce({ count: 101, rows: rows(1, 1) });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: false, scannedRows: scenario === 'within page' ? 0 : 100, partialReason: expect.stringContaining('repeated loan numbers') });
  });
  it('groups absent and invalid originator emails as unknown instead of echoing arbitrary provider values', async () => {
    m.api.mockResolvedValue({ count: 3, rows: [{ ariveLoanId: 1 }, { ariveLoanId: 2, loanOriginatorEmail: 'never-return-unstructured-value' }, { ariveLoanId: 3, loanOriginatorEmail: ' Known@Example.Test ' }] });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ complete: true, originators: [{ email: null, name: 'Unknown originator', count: 2 }, { email: 'known@example.test', name: 'known@example.test', count: 1 }] });
  });
  it('retains earlier validated pages when a provider read fails, without exposing its raw error', async () => {
    m.api.mockResolvedValueOnce({ count: 200, rows: rows(1, 100) }).mockRejectedValueOnce(new Error('never-return-provider-secret'));
    const result = await inspectAriveLoanCoverage();
    expect(result).toMatchObject({ complete: false, scannedRows: 100, partialReason: expect.stringContaining('could not complete') });
    expect(JSON.stringify(result)).not.toContain('never-return-provider-secret');
  });
  it('throttles repeated inspections before any session, portal inventory, or provider read', async () => {
    m.recentProbe.mockResolvedValue({ id: 'recent' });
    expect(await inspectAriveLoanCoverage()).toMatchObject({ success: false, error: expect.stringContaining('five minutes') });
    expect(m.recentProbe).toHaveBeenCalledWith({ where: { action: 'ARIVE_LOAN_VISIBILITY_STARTED', createdAt: { gt: expect.any(Date) } }, select: { id: true } });
    expect(m.candidates).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it('requires the shared budget and honors cooldown without issuing a diagnostic', async () => {
    m.budget.mockResolvedValue({ ready: false, reason: 'Provider cooldown' });
    expect(await inspectAriveLoanCoverage()).toEqual({ success: false, error: 'Provider cooldown' });
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
  });
});

describe('protected existing-loan access comparison', () => {
  it('selects only a single existing portal loan and never trusts client-supplied borrower or credentials', async () => {
    m.candidates.mockResolvedValue([{ loan: state.row.loan }]);
    const input = { loanNumber: '99999123', borrowerName: 'forged borrower', secret: 'forged secret' };
    expect(await compareAriveLoanAccess(input)).toMatchObject({ success: true, loanNumber: '99999123', getRequests: 6 });
    expect(access.compare).toHaveBeenCalledWith(state.row.loan);
    expect(m.candidates.mock.calls[0][0]).toMatchObject({ where: { loan: { loanNumber: '99999123' } }, take: 2 });
    expect(m.audit.mock.calls[0][0].data).toMatchObject({ userId: 'admin', loanId: 'loan-test', action: 'ARIVE_LOAN_ACCESS_STARTED' });
    expect(m.audit.mock.calls.at(-1)?.[0].data.action).toBe('ARIVE_LOAN_ACCESS_COMPLETED');
    expect(m.controlWrite).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled(); expect(cohort.queue).not.toHaveBeenCalled(); expect(m.apiSession).not.toHaveBeenCalled();
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('forged');
  });
  it.each(['', '123&limit=1000', 'abc', '1234567890123456'])('rejects invalid numeric input %s before queries', async loanNumber => {
    expect((await compareAriveLoanAccess({ loanNumber })).success).toBe(false);
    expect(m.candidates).not.toHaveBeenCalled(); expect(access.compare).not.toHaveBeenCalled();
  });
  it.each([0, 2])('rejects a target resolving to %s existing portal records', async count => {
    m.candidates.mockResolvedValue(Array.from({ length: count }, () => ({ loan: state.row.loan })));
    expect((await compareAriveLoanAccess({ loanNumber: '99999123' })).success).toBe(false);
    expect(access.compare).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it('honors the shared budget and the global five-minute attempt throttle', async () => {
    m.candidates.mockResolvedValue([{ loan: state.row.loan }]); m.budget.mockResolvedValueOnce({ ready: false, reason: 'Shared cooldown' });
    expect(await compareAriveLoanAccess({ loanNumber: '99999123' })).toMatchObject({ success: false, error: 'Shared cooldown' });
    expect(m.candidates).not.toHaveBeenCalled();
    m.recentProbe.mockResolvedValue({ id: 'recent' });
    expect(await compareAriveLoanAccess({ loanNumber: '99999123' })).toMatchObject({ success: false, error: expect.stringContaining('five minutes') });
    expect(m.recentProbe).toHaveBeenCalledWith({ where: { action: 'ARIVE_LOAN_ACCESS_STARTED', createdAt: { gt: expect.any(Date) } }, select: { id: true } });
    expect(access.compare).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
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
