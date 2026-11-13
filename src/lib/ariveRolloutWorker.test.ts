import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('./ariveTransportPrisma', () => ({ isAriveBudgetReady: vi.fn() }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { AriveError } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
import { syncAriveRolloutLoan, runDueAriveRolloutSyncs } from './ariveRolloutWorker';
import { enrollAriveRolloutBatch, verifyAriveRolloutIdentity, type AriveRolloutDeps } from './ariveRollout';

type Data = Record<string, unknown>;
const clone = <T,>(v: T): T => structuredClone(v);
const date = (value: string) => new Date(value);
const tracker = (name: string, status: string, at: string | null = null) => ({ name, currentTrackerStatus: { name: status, date: at }, trackerStatusesHistory: [] });
function harness() {
  vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Tests must not use the network'); }));
  let time = date('2026-11-12T20:00:00Z');
  const initial = {
    row: { id: 'pipeline-other', loanId: 'loan-other', sourceTaskId: 'ordinary-task', version: 1,
      sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: date('2026-10-01'), movedAt: null as Date | null, archivedAt: null as Date | null, archivedById: null as string | null,
      titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null, hoiOrderedAt: null,
      appraisalNeeded: null, appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null,
      cdSent: false, cdWarningStartsAt: null, rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null,
      rateLockRequestedAt: null as Date | null, rateLockRequestedById: null as string | null, approvedWithConditionsAt: null, fundedAt: null as Date | null,
      estimatedSigningAt: null as Date | null, payoffExpiresAt: null as Date | null, missingItemsCurrentStatus: null,
      seniorProcessorId: 'senior', juniorProcessorId: 'junior', finalRevenue: 2000, projectedRevenue: 2100,
      firstPaymentAt: null as Date | null, sixthPaymentAt: null as Date | null,
      loan: { id: 'loan-other', loanNumber: '99999123', borrowerName: 'Synthetic Borrower', borrowerFirstName: 'Synthetic', borrowerLastName: 'Borrower',
        loanOfficer: { email: 'other@example.test' }, secondaryLoanOfficer: null as { email: string } | null, payrollCompRequests: [] as { id: string }[] },
    },
    sync: { id: 'sync-other', pipelineId: 'pipeline-other', enabled: true, enabledById: 'admin', workerOwner: 'GENERALIZED', workerGeneration: 1,
      connectionId: 'company', ariveLoanId: '99999123', ariveGuid: 'remote-other', verifiedOriginatorEmail: 'other@example.test', verifiedAt: date('2026-11-12'),
      enrollmentStatus: 'VERIFIED', enrollmentIssue: null as string | null, sourceStage: null as string | null, everFunded: false, operatorPaused: false,
      routingProvenance: {} as Data, snapshot: {} as Data, fieldSources: {} as Data, issues: [] as Data[], conflicts: [] as Data[], snapshotHash: null as string | null,
      collectedSnapshot: {} as Data, collectedAt: null as Date | null, manualRefreshRequestedAt: null as Date | null,
      lastAttemptAt: null as Date | null, lastSuccessAt: null as Date | null, nextAttemptAt: null as Date | null, lastError: null as string | null, failureCount: 0,
      leaseToken: null as string | null, leaseUntil: null as Date | null,
    },
    control: { id: 'company', collectionEnabled: true, applicationEnabled: true, enrollmentEnabled: true, enabledById: 'admin', generation: 1, enrollmentCursor: null as string | null, cohortLimit: 10 as number | null },
    notes: null as { contentHash: string; notes: unknown; syncedAt: Date } | null,
    audits: [] as Data[], practice: false,
  };
  let store = clone(initial); let transactionCount = 0; let beforeApply: (() => void) | undefined; let failNotesWrite = false; let activeLeases = 0; let enrolledCount = 0;
  const mutate = (target: object, data: Data) => { for (const [key, value] of Object.entries(data)) (target as Data)[key] = value && typeof value === 'object' && 'increment' in value ? Number((target as Data)[key]) + Number(value.increment) : clone(value); };
  const client = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    ariveRolloutControl: { findUnique: vi.fn(async () => clone(store.control)), updateMany: vi.fn(async ({ data }: { data: Data }) => { mutate(store.control, data); return { count: 1 }; }) },
    arivePracticeLoan: { findFirst: vi.fn(async () => store.practice ? { ariveLoanId: store.sync.ariveLoanId } : null) },
    processingPipelineLoan: {
      findUnique: vi.fn(async () => ({ ...clone(store.row), ariveSync: clone(store.sync) })),
      findMany: vi.fn(async () => [{ ...clone(store.row), ariveSync: clone(store.sync) }]),
      updateMany: vi.fn(async ({ where, data }: { where: { version: number }; data: Data }) => { if (where.version !== store.row.version) return { count: 0 }; mutate(store.row, data); return { count: 1 }; }),
    },
    arivePipelineSync: {
      count: vi.fn(async ({ where }: { where: Data }) => 'leaseUntil' in where ? activeLeases : enrolledCount),
      findMany: vi.fn(async ({ where }: { where: { pipelineId: { notIn: string[] } } }) => where.pipelineId.notIn.includes(store.row.id) ? [] : [{ pipelineId: store.row.id }]),
      update: vi.fn(async ({ data }: { data: Data }) => { mutate(store.sync, data); return clone(store.sync); }),
      updateMany: vi.fn(async ({ where, data }: { where: { leaseToken?: string; workerOwner?: string; workerGeneration?: number; manualRefreshRequestedAt?: null }; data: Data }) => {
        if (where.leaseToken && where.leaseToken !== store.sync.leaseToken
          || where.workerOwner && where.workerOwner !== store.sync.workerOwner
          || where.workerGeneration !== undefined && where.workerGeneration !== store.sync.workerGeneration
          || where.manualRefreshRequestedAt === null && store.sync.manualRefreshRequestedAt !== null) return { count: 0 };
        mutate(store.sync, data); return { count: 1 };
      }),
      upsert: vi.fn(async ({ update }: { update: Data }) => { mutate(store.sync, update); return clone(store.sync); }),
    },
    ariveLoanNotes: {
      findUnique: vi.fn(async () => clone(store.notes)),
      upsert: vi.fn(async ({ create }: { create: { notes: unknown; contentHash: string; syncedAt: Date } }) => { if (failNotesWrite) throw new Error('synthetic DB failure'); store.notes = clone(create); return create; }),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Data }) => { store.audits.push(clone(data)); return data; }) },
    task: { update: vi.fn(), create: vi.fn() }, loan: { create: vi.fn() }, notificationOutbox: { create: vi.fn() },
  };
  const db = { ...client, $transaction: vi.fn(async (work: (tx: typeof client) => Promise<unknown>) => {
    transactionCount++; if (transactionCount % 2 === 0) beforeApply?.(); const backup = clone(store);
    try { return await work(client); } catch (error) { store = backup; throw error; }
  }) };
  const remote = {
    details: { ariveLoanId: 99999123, sysGUID: 'remote-other', loanOriginatorEmail: 'other@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }],
      currentLoanStatus: { status: 'APPLICATION_INTAKE', date: '2026-11-10', adverseReason: '' }, loanStatusHistory: [] as Data[], archiveIndicator: false, modifiedDateTime: '2026-11-12T19:00:00Z', keyDates: {}, lockDate: null as string | null },
    trackers: [tracker('TITLE', 'NOT_ORDERED'), tracker('HOI', 'NOT_ORDERED'), tracker('PAYOFFS', 'NOT_ORDERED'), tracker('APPRAISAL', 'NOT_ORDERED'), tracker('CD', 'NOT_SENT'), tracker('RATE_LOCK', 'None')],
    notes: [] as Data[], notesFailure: false, transportFailure: false,
  };
  const api = vi.fn(async (path: string, body?: object, method?: 'PATCH'): Promise<Data> => {
    if (body || method) throw new Error('Unexpected Arive write');
    if (remote.transportFailure) throw new AriveTransportError('BUDGET_EXHAUSTED', 'Synthetic budget exhausted', date('2026-11-12T21:00:00Z'));
    if (path.includes('searchField=')) return { rows: [{ ariveLoanId: 99999123, sysGUID: 'remote-other' }] };
    if (path.endsWith('/trackers')) return { loanTrackers: clone(remote.trackers) };
    if (path.includes('/notes?')) { if (remote.notesFailure) throw new AriveError('Synthetic notes failure'); return { count: remote.notes.length, loanNotes: clone(remote.notes) }; }
    if (path === '/loans/remote-other') return clone(remote.details);
    throw new Error('Unexpected path');
  });
  const session = vi.fn(async () => api); const budgetReady = vi.fn(async () => ({ ready: true, reason: null as string | null }));
  const deps: AriveRolloutDeps = { db: db as unknown as AriveRolloutDeps['db'], session, budgetReady, now: () => new Date(time) };
  return { get store() { return store; }, remote, db, client, session, api, deps, budgetReady,
    run: () => syncAriveRolloutLoan(store.row.id, deps), advance: () => { time = new Date(time.getTime() + 61 * 60_000); },
    beforeApply: (fn: () => void) => { beforeApply = fn; }, failNotes: () => { failNotesWrite = true; }, leases: (n: number) => { activeLeases = n; }, enrolled: (n: number) => { enrolledCount = n; },
  };
}
const note = (text: string) => ({ id: 1, text, createdByName: 'Synthetic processor', createdAt: '2026-11-12T19:00:00Z', updatedAt: '2026-11-12T19:00:00Z', nestedNotes: [] });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('generalized worker isolation and atomic application', () => {
  it('is off by default and never claims legacy-owned rows', async () => {
    const h = harness(); vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); expect(await h.run()).toMatchObject({ skipped: true }); expect(h.db.$transaction).not.toHaveBeenCalled();
    vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true'); h.store.sync.workerOwner = 'LEGACY'; expect(await h.run()).toMatchObject({ skipped: true }); expect(h.session).not.toHaveBeenCalled();
  });
  it('requires the provider budget before reads and globally caps active file leases', async () => {
    const h = harness(); h.budgetReady.mockResolvedValueOnce({ ready: false, reason: 'Quota not confirmed' }); await expect(h.run()).rejects.toThrow('Quota not confirmed');
    h.leases(2); expect(await h.run()).toMatchObject({ skipped: true }); expect(h.api).not.toHaveBeenCalled();
  });
  it('applies a different verified loan and independent notes using GET only, without touching tasks or financial approvals', async () => {
    const h = harness(); h.remote.details.currentLoanStatus.status = 'DOCS_SIGNED'; h.remote.trackers[0] = tracker('TITLE', 'RECEIVED'); h.remote.notes = [note('Pending Items: revised paystub')];
    expect(await h.run()).toMatchObject({ success: true, applied: true });
    expect(h.store.row).toMatchObject({ pipelineStatus: 'DOCS_OUT', titleStatus: 'RECEIVED', missingItemsCurrentStatus: 'revised paystub', finalRevenue: 2000, seniorProcessorId: 'senior' });
    expect(h.store.notes?.notes).toEqual([expect.objectContaining({ id: '1', text: 'Pending Items: revised paystub' })]);
    expect(h.store.sync.sourceStage).toBe('DOCS_SIGNED'); expect(h.store.sync.snapshot.managed).toMatchObject({ sheet: 'PIPELINE', pipelineStatus: 'DOCS_OUT', rateLock: false });
    expect(h.api.mock.calls.every(c => c[1] === undefined && c[2] === undefined)).toBe(true); expect(h.client.task.create).not.toHaveBeenCalled(); expect(h.client.task.update).not.toHaveBeenCalled(); expect(h.client.notificationOutbox.create).not.toHaveBeenCalled();
  });
  it('collects a preview without advancing applied snapshot, ownership, notes or row version', async () => {
    const h = harness(); h.store.control.applicationEnabled = false; h.remote.details.currentLoanStatus.status = 'SUSPENDED'; h.remote.notes = [note('Pending Items: insurance')];
    const before = clone(h.store.row); expect(await h.run()).toMatchObject({ applied: false }); expect(h.store.row).toEqual(before);
    expect(h.store.sync.collectedSnapshot).toMatchObject({ source: { stage: 'SUSPENDED' }, structuredValues: { pendingItems: 'insurance' } });
    for (const key of ['snapshot', 'fieldSources', 'routingProvenance'] as const) expect(h.store.sync[key]).toEqual({});
    expect(h.store.sync.lastSuccessAt).toBeNull(); expect(h.store.sync.sourceStage).toBeNull(); expect(h.store.notes).toBeNull(); expect(h.store.audits).toHaveLength(0);
  });
  it('repeats an identical refresh without additional version, audit or notes write', async () => {
    const h = harness(); await h.run(); const version = h.store.row.version; const auditCount = h.store.audits.length; const noteWrites = h.client.ariveLoanNotes.upsert.mock.calls.length;
    h.advance(); expect(await h.run()).toMatchObject({ changed: false }); expect(h.store.row.version).toBe(version); expect(h.store.audits).toHaveLength(auditCount); expect(h.client.ariveLoanNotes.upsert).toHaveBeenCalledTimes(noteWrites);
  });
  it.each(['pause', 'owner', 'generation', 'control generation', 'practice'])('fences an in-flight read after %s changes', async change => {
    const h = harness(); h.beforeApply(() => {
      if (change === 'pause') h.store.sync.enabled = false;
      if (change === 'owner') h.store.sync.workerOwner = 'LEGACY';
      if (change === 'generation') h.store.sync.workerGeneration++;
      if (change === 'control generation') h.store.control.generation++;
      if (change === 'practice') h.store.practice = true;
    });
    expect(await h.run()).toMatchObject({ skipped: true }); expect(h.client.processingPipelineLoan.updateMany).not.toHaveBeenCalled(); expect(h.store.notes).toBeNull();
  });
  it.each(['identity', 'notes', 'transaction'])('retains applied data on %s failure', async failure => {
    const h = harness(); const before = clone(h.store.row);
    if (failure === 'identity') h.remote.details.loanOriginatorEmail = 'outside@example.test';
    if (failure === 'notes') h.remote.notesFailure = true;
    if (failure === 'transaction') h.failNotes();
    expect(await h.run()).toMatchObject({ success: false }); expect(h.store.row).toEqual(before); expect(h.store.notes).toBeNull(); expect(h.store.sync.lastSuccessAt).toBeNull(); expect(h.store.audits).toHaveLength(0);
  });
  it('remembers collection-only funding after later source history is truncated', async () => {
    const h = harness(); h.store.control.applicationEnabled = false; h.remote.details.currentLoanStatus.status = 'LOAN_FUNDED'; await h.run();
    expect(h.store.sync.everFunded).toBe(false); expect(h.store.sync.collectedSnapshot.everFunded).toBe(true);
    h.advance(); h.store.control.applicationEnabled = true; h.remote.details.currentLoanStatus.status = 'SUSPENDED'; await h.run();
    expect(h.store.row.sheet).toBe('PIPELINE'); expect(h.store.sync.everFunded).toBe(true); expect(h.store.sync.issues).toContainEqual(expect.objectContaining({ code: 'FUNDED_REVERSAL_REVIEW' }));
  });
  it('recognizes existing approved financial history without relying on the current folder', async () => {
    const h = harness(); h.store.row.loan.payrollCompRequests = [{ id: 'approved-finance' }]; h.remote.details.currentLoanStatus = { status: 'APPLICATION_INTAKE', date: '2026-11-10', adverseReason: 'APP_WITHDRAWN_BY_BORROWER' };
    await h.run(); expect(h.store.row.archivedAt).toBeNull(); expect(h.store.sync.everFunded).toBe(true);
  });
  it('fills only missing payment dates and retains final revenue on funding', async () => {
    const h = harness(); h.store.row.firstPaymentAt = date('2027-01-01'); h.remote.details.currentLoanStatus.status = 'LOAN_FUNDED'; await h.run();
    expect(h.store.row).toMatchObject({ sheet: 'FUNDING', firstPaymentAt: date('2027-01-01'), sixthPaymentAt: date('2027-05-10'), finalRevenue: 2000 });
  });
  it('clears a headed date and checks missing information after that clear', async () => {
    const h = harness(); h.store.row.estimatedSigningAt = date('2026-11-15'); h.remote.details.currentLoanStatus.status = 'DOCS_SIGNED'; h.remote.notes = [note('Scheduled Signing: clear')]; await h.run();
    expect(h.store.row.estimatedSigningAt).toBeNull(); expect(h.store.sync.issues).toContainEqual(expect.objectContaining({ code: 'MISSING_SIGNING_DATE' }));
  });
  it('does not let an old lock clear a newer portal request', async () => {
    const h = harness(); h.store.row.rateLockRequestedAt = date('2026-11-12T10:00:00Z'); h.store.row.rateLockRequestedById = 'manager'; h.remote.details.lockDate = '2026-11-10'; h.remote.trackers[5] = tracker('RATE_LOCK', 'Locked'); await h.run();
    expect(h.store.row.rateLockRequestedAt).toEqual(date('2026-11-12T10:00:00Z'));
  });
  it('stops a scheduler wave on global budget exhaustion and does not spin on the same file', async () => {
    const h = harness(); h.remote.transportFailure = true; expect(await runDueAriveRolloutSyncs(h.deps)).toMatchObject({ checked: 1, failed: 1 });
    expect(h.client.arivePipelineSync.findMany).toHaveBeenCalledTimes(1); expect(h.store.sync.nextAttemptAt).toEqual(date('2026-11-12T21:00:00Z'));
  });
  it.each(['PIPELINE', 'RESTRUCTURE'])('makes a successfully read %s file due after one minute', async sheet => {
    const h = harness(); h.store.row.sheet = sheet;
    if (sheet === 'RESTRUCTURE') h.remote.details.currentLoanStatus.status = 'SUSPENDED';
    expect(await h.run()).toMatchObject({ success: true, applied: true });
    expect(h.store.sync.nextAttemptAt).toEqual(date('2026-11-12T20:01:00Z'));
  });
  it('keeps funded files on the hourly schedule', async () => {
    const h = harness(); h.remote.details.currentLoanStatus.status = 'LOAN_FUNDED';
    await h.run();
    expect(h.store.row.sheet).toBe('FUNDING');
    expect(h.store.sync.nextAttemptAt).toEqual(date('2026-11-12T21:00:00Z'));
  });
  it.each([[0, 5], [1, 10], [4, 60], [15, 60]])('preserves failure backoff for %i previous failures', async (failures, minutes) => {
    const h = harness(); h.store.sync.failureCount = failures; h.remote.notesFailure = true;
    expect(await h.run()).toMatchObject({ success: false });
    expect(h.store.sync.nextAttemptAt).toEqual(new Date(date('2026-11-12T20:00:00Z').getTime() + minutes * 60_000));
  });
  it('prioritizes the oldest manual request, then oldest due file, within two-file waves', async () => {
    const h = harness(); await runDueAriveRolloutSyncs(h.deps);
    expect(h.client.arivePipelineSync.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [
        { manualRefreshRequestedAt: { sort: 'asc', nulls: 'last' } },
        { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
        { pipelineId: 'asc' },
      ], take: 2,
    }));
  });
  it('can process more than fifty due files but bounds one invocation at five hundred', async () => {
    const h = harness();
    h.client.arivePipelineSync.findMany.mockImplementation(async ({ where }) => {
      const id = `synthetic-${where.pipelineId.notIn.length}`;
      h.store.row.id = id; h.store.sync.pipelineId = id;
      h.store.sync.lastAttemptAt = null; h.store.sync.nextAttemptAt = null;
      return [{ pipelineId: id }];
    });
    expect(await runDueAriveRolloutSyncs(h.deps)).toEqual({ checked: 500, succeeded: 500, failed: 0 });
    expect(h.client.arivePipelineSync.findMany).toHaveBeenCalledTimes(500);
    expect(h.client.arivePipelineSync.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });
  it('does not start another wave without thirty seconds left in the invocation', async () => {
    const h = harness();
    expect(await runDueAriveRolloutSyncs({ ...h.deps, deadlineMs: Date.now() + 29_000 })).toEqual({ checked: 0, succeeded: 0, failed: 0 });
    expect(h.client.arivePipelineSync.findMany).not.toHaveBeenCalled();
    expect(h.api).not.toHaveBeenCalled();
  });
  it('retains a failed manual request without letting it bypass retry backoff', async () => {
    const h = harness(); h.store.sync.manualRefreshRequestedAt = date('2026-11-12T19:59:00Z'); h.remote.notesFailure = true;
    await h.run(); expect(h.store.sync.manualRefreshRequestedAt).toEqual(date('2026-11-12T19:59:00Z')); const requests = h.api.mock.calls.length;
    expect(await h.run()).toMatchObject({ skipped: true }); expect(h.api).toHaveBeenCalledTimes(requests);
  });
  it.each(['old funding', 'manual archive'])('retries a deferred %s manual refresh after cooldown and consumes it only on success', async kind => {
    const h = harness();
    if (kind === 'old funding') {
      h.store.row.sheet = 'FUNDING'; h.store.row.fundedAt = date('2026-05-10');
      h.remote.details.currentLoanStatus = { status: 'LOAN_FUNDED', date: '2026-05-10', adverseReason: '' };
    } else h.store.row.archivedAt = date('2026-11-10');
    h.store.sync.manualRefreshRequestedAt = date('2026-11-12T19:59:00Z'); h.remote.transportFailure = true;
    expect(await h.run()).toMatchObject({ success: false, deferred: true });
    expect(h.store.sync.manualRefreshRequestedAt).toEqual(date('2026-11-12T19:59:00Z'));
    expect(h.store.sync.nextAttemptAt).toEqual(date('2026-11-12T21:00:00Z'));
    expect(await h.run()).toMatchObject({ skipped: true });
    h.advance(); h.remote.transportFailure = false;
    expect(await h.run()).toMatchObject({ success: true, applied: true });
    expect(h.store.sync.manualRefreshRequestedAt).toBeNull();
    h.advance(); expect(await h.run()).toMatchObject({ skipped: true });
  });
  it('does not overwrite a newer pending request while restoring a failed one', async () => {
    const h = harness(); h.store.sync.manualRefreshRequestedAt = date('2026-11-12T19:59:00Z'); h.remote.notesFailure = true;
    h.beforeApply(() => { h.store.sync.manualRefreshRequestedAt = date('2026-11-12T20:00:01Z'); });
    expect(await h.run()).toMatchObject({ success: false });
    expect(h.store.sync.manualRefreshRequestedAt).toEqual(date('2026-11-12T20:00:01Z'));
  });
  it.each(['pause', 'generation'])('does not restore a failed manual request after %s fences its lease', async change => {
    const h = harness(); h.store.sync.manualRefreshRequestedAt = date('2026-11-12T19:59:00Z'); h.remote.notesFailure = true;
    h.beforeApply(() => { if (change === 'pause') { h.store.sync.enabled = false; h.store.sync.leaseToken = null; } else h.store.sync.workerGeneration++; });
    expect(await h.run()).toMatchObject({ success: false });
    expect(h.store.sync.manualRefreshRequestedAt).toBeNull();
    expect(h.store.sync.failureCount).toBe(0);
  });
  it('preserves a new manual refresh queued after the current read began', async () => {
    const h = harness(); h.beforeApply(() => { h.store.sync.manualRefreshRequestedAt = date('2026-11-12T20:00:01Z'); });
    await h.run(); expect(h.store.sync.manualRefreshRequestedAt).toEqual(date('2026-11-12T20:00:01Z'));
  });
});

describe('existing-portal enrollment', () => {
  it.each([false, true])('retries the same transport-deferred enrollment candidate (prior scanned: %s)', async prior => {
    const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false;
    h.store.control.enrollmentCursor = 'pipeline-before'; h.remote.transportFailure = true;
    const candidate = { ...clone(h.store.row), ariveSync: clone(h.store.sync) };
    h.client.processingPipelineLoan.findMany.mockResolvedValueOnce(prior
      ? [{ ...clone(candidate), id: 'pipeline-checked', ariveSync: { ...clone(h.store.sync), enabled: true, enrollmentStatus: 'VERIFIED' } }, candidate]
      : [candidate]);
    expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ scanned: prior ? 1 : 0, verified: 0 });
    expect(h.store.control.enrollmentCursor).toBe(prior ? 'pipeline-checked' : 'pipeline-before');
    expect(h.client.arivePipelineSync.upsert).not.toHaveBeenCalled();
  });
  it('scans twenty-five candidates and advances the cursor until the final partial batch', async () => {
    const h = harness();
    const candidates = Array.from({ length: 25 }, (_, index) => ({ ...clone(h.store.row), id: `pipeline-${String(index).padStart(2, '0')}`, ariveSync: clone(h.store.sync) }));
    h.client.processingPipelineLoan.findMany.mockResolvedValueOnce(candidates);
    expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ scanned: 25, verified: 0 });
    expect(h.client.processingPipelineLoan.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
    expect(h.store.control.enrollmentCursor).toBe('pipeline-24');
    h.client.processingPipelineLoan.findMany.mockResolvedValueOnce([{ ...clone(h.store.row), id: 'pipeline-25', ariveSync: clone(h.store.sync) }]);
    expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ scanned: 1 });
    expect(h.client.processingPipelineLoan.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { AND: expect.arrayContaining([{ id: { gt: 'pipeline-24' } }]) }, take: 25,
    }));
    expect(h.store.control.enrollmentCursor).toBeNull();
    expect(h.api).not.toHaveBeenCalled();
  });
  it('does not take a legacy row or create any new loan/task records', async () => {
    const h = harness(); h.store.sync.workerOwner = 'LEGACY'; expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ verified: 0 });
    expect(h.api).not.toHaveBeenCalled(); expect(h.client.loan.create).not.toHaveBeenCalled(); expect(h.client.task.create).not.toHaveBeenCalled();
  });
  it('verifies the loan ID, permanent ID, borrower and assigned originator before enabling', async () => {
    const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false;
    expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ verified: 1 }); expect(h.store.sync).toMatchObject({ enabled: true, enrollmentStatus: 'VERIFIED', verifiedOriginatorEmail: 'other@example.test' });
  });
  it('records practice exclusion and missing funded-date exceptions without remote requests', async () => {
    for (const cause of ['practice', 'funding']) {
      const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false;
      if (cause === 'practice') h.store.practice = true; else h.store.row.sheet = 'FUNDING';
      await enrollAriveRolloutBatch(h.deps); expect(h.store.sync.enabled).toBe(false); expect(h.store.sync.enrollmentIssue).toBeTruthy(); expect(h.api).not.toHaveBeenCalled();
    }
  });
  it('enforces the cohort limit and never automatically reenables an operator-paused loan', async () => {
    const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false; h.enrolled(10);
    await enrollAriveRolloutBatch(h.deps); expect(h.store.sync).toMatchObject({ enrollmentStatus: 'VERIFIED', enabled: false });
    h.store.sync.operatorPaused = true; h.advance(); h.enrolled(0); await enrollAriveRolloutBatch(h.deps); expect(h.store.sync.enabled).toBe(false);
  });
  it.each(['pause', 'archive', 'new verification'])('fences an enrollment candidate changed by %s during verification', async cause => {
    const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false;
    h.api.mockImplementationOnce(async () => {
      if (cause === 'pause') h.store.sync.operatorPaused = true;
      if (cause === 'archive') h.store.row.archivedAt = date('2026-11-12');
      if (cause === 'new verification') { h.store.sync.enrollmentStatus = 'VERIFIED'; h.store.sync.enabled = true; }
      return { rows: [{ ariveLoanId: 99999123, sysGUID: 'remote-other' }] };
    });
    expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ verified: 0 }); expect(h.client.arivePipelineSync.upsert).not.toHaveBeenCalled();
  });
  it('explicitly enrolls an older existing funding for one queued read without enabling ongoing old-file polling', async () => {
    const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false; h.store.control.enrollmentEnabled = false;
    h.store.row.sheet = 'FUNDING'; h.store.row.fundedAt = date('2026-05-10');
    h.remote.details.currentLoanStatus = { status: 'LOAN_FUNDED', date: '2026-05-10', adverseReason: '' };
    expect(await enrollAriveRolloutBatch(h.deps, { pipelineId: h.store.row.id })).toMatchObject({ verified: 1 });
    expect(h.client.processingPipelineLoan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: h.store.row.id }, take: 1 }));
    expect(h.store.sync.manualRefreshRequestedAt).toBeInstanceOf(Date); expect(await h.run()).toMatchObject({ success: true, applied: true });
    h.advance(); expect(await h.run()).toMatchObject({ skipped: true });
  });
  it('accepts a verified secondary originator and multiple applicant pairs without fuzzy borrower matching', () => {
    const h = harness(); h.store.row.loan.secondaryLoanOfficer = { email: 'secondary@example.test' }; h.remote.details.loanOriginatorEmail = 'secondary@example.test';
    h.remote.details.loanBorrowers.push({ applicantType: 'Borrower', firstName: 'Another', lastName: 'Applicant' });
    expect(verifyAriveRolloutIdentity(h.remote.details, h.store.row.loan)).toMatchObject({ originatorEmail: 'secondary@example.test' });
    h.store.row.loan.borrowerLastName = 'Borrower Jr'; expect(() => verifyAriveRolloutIdentity(h.remote.details, h.store.row.loan)).toThrow('exactly match');
  });
});


it('quarantines an incomplete search even when its first page contains one exact match', async () => {
  const h = harness(); h.store.sync.enrollmentStatus = 'PENDING'; h.store.sync.enabled = false;
  h.api.mockImplementationOnce(async () => ({ count: 2, rows: [{ ariveLoanId: 99999123, sysGUID: 'remote-other' }] }));
  expect(await enrollAriveRolloutBatch(h.deps)).toMatchObject({ verified: 0, review: 1 });
  expect(h.store.sync.enrollmentStatus).toBe('REVIEW');
  expect(h.store.sync.enabled).toBe(false);
});
