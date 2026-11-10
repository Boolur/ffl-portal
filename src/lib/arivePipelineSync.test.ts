import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { AriveError } from './ariveClient';
import { ARIVE_SYNC_PILOT } from './ariveSyncTypes';
import { syncArivePipeline, runDueArivePipelineSyncs } from './arivePipelineSync';

type ObjectData = Record<string, unknown>;
const date = (value: string) => new Date(value);
const clone = <T,>(value: T): T => structuredClone(value);
const tracker = (name: string, status: string, at: string | null = null) => ({ name, currentTrackerStatus: { name: status, date: at }, trackerStatusesHistory: [] });
function harness() {
  let time = date('2026-11-05T22:00:00Z');
  const initial = {
    row: {
      id: 'pipeline-test', loanId: ARIVE_SYNC_PILOT.loanId, sourceTaskId: 'request-test', version: 1,
      sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: date('2026-10-15'), movedAt: null as Date | null, archivedAt: null as Date | null,
      titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null as Date | null, hoiOrderedAt: null as Date | null,
      appraisalNeeded: null as boolean | null, appraisalOrderedAt: null as Date | null, appraisalScheduledAt: null as Date | null, appraisalBackAt: null as Date | null,
      cdSent: false, cdWarningStartsAt: null as Date | null, rateLock: false, rateLockExpiresAt: null as Date | null, rateLockConfirmedAt: null as Date | null,
      rateLockRequestedAt: null as Date | null, rateLockRequestedById: null as string | null, approvedWithConditionsAt: null as Date | null, fundedAt: null as Date | null,
      estimatedSigningAt: null as Date | null, payoffExpiresAt: null as Date | null, missingItemsCurrentStatus: null as string | null,
      seniorProcessorId: 'senior', juniorProcessorId: 'junior', processingMethod: 'IN_HOUSE', finalRevenue: 1200, projectedRevenue: 1500,
      firstPaymentAt: date('2027-01-01'), sixthPaymentAt: date('2027-06-01'), payrollApproved: true,
      loan: { id: ARIVE_SYNC_PILOT.loanId, loanNumber: ARIVE_SYNC_PILOT.loanNumber, borrowerName: 'TESTING TESTER', loanOfficerId: ARIVE_SYNC_PILOT.ownerId, loanOfficer: { email: 'matt@example.test' } },
      sourceTask: { submissionData: { processingDocumentTaskId: 'package-test' } },
    },
    sync: {
      id: 'sync-test', pipelineId: 'pipeline-test', enabled: true, enabledById: 'admin', ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, ariveGuid: 'remote-guid',
      lastAttemptAt: null as Date | null, lastSuccessAt: null as Date | null, nextAttemptAt: null as Date | null, failureCount: 0, lastError: null as string | null,
      leaseToken: null as string | null, leaseUntil: null as Date | null, snapshot: {} as ObjectData, fieldSources: {} as ObjectData,
      conflicts: [] as ObjectData[], issues: [] as ObjectData[], snapshotHash: null as string | null,
    },
    task: { id: 'package-test', loanId: ARIVE_SYNC_PILOT.loanId, updatedAt: date('2026-10-15'), submissionData: { submissionPilot: {
      version: 1, revision: 5, state: 'APPROVED', items: [], history: [{ message: 'Jr approved package' }], ariveLink: { id: 'remote-guid', loanNumber: ARIVE_SYNC_PILOT.loanNumber },
      ariveNotes: { syncedAt: '2026-10-15T00:00:00Z', notes: [] as unknown[] },
    } } },
    audits: [] as ObjectData[],
  };
  let store = clone(initial);
  let transactionNumber = 0;
  let beforeApply: (() => void) | undefined;
  let failPackageWrite = false;
  const apply = (target: object, values: ObjectData) => { for (const [key, value] of Object.entries(values)) (target as ObjectData)[key] = key === 'version' && value && typeof value === 'object' && 'increment' in value ? Number((target as ObjectData)[key]) + Number(value.increment) : clone(value); };
  const client = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    processingPipelineLoan: {
      findUnique: vi.fn(async () => ({ ...clone(store.row), ariveSync: clone(store.sync) })),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; version: number }; data: ObjectData }) => {
        if (where.id !== store.row.id || where.version !== store.row.version) return { count: 0 };
        apply(store.row, data); return { count: 1 };
      }),
    },
    arivePipelineSync: {
      update: vi.fn(async ({ data }: { data: ObjectData }) => { apply(store.sync, data); return clone(store.sync); }),
      updateMany: vi.fn(async ({ where, data }: { where: { pipelineId: string; leaseToken: string }; data: ObjectData }) => {
        if (where.pipelineId !== store.sync.pipelineId || where.leaseToken !== store.sync.leaseToken) return { count: 0 };
        apply(store.sync, data); return { count: 1 };
      }),
      findMany: vi.fn(async () => store.sync.enabled && (!store.sync.nextAttemptAt || store.sync.nextAttemptAt <= time) && (!store.sync.leaseUntil || store.sync.leaseUntil <= time) ? [{ pipelineId: store.row.id }] : []),
    },
    auditLog: { create: vi.fn(async ({ data }: { data: ObjectData }) => { store.audits.push(clone(data)); return data; }) },
    task: {
      findUnique: vi.fn(async () => clone(store.task)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; updatedAt: Date }; data: ObjectData }) => {
        if (failPackageWrite || where.id !== store.task.id || where.updatedAt.getTime() !== store.task.updatedAt.getTime()) return { count: 0 };
        apply(store.task, data); store.task.updatedAt = new Date(time); return { count: 1 };
      }),
    },
  };
  const db = { ...client, $transaction: vi.fn(async (work: (tx: typeof client) => Promise<unknown>) => {
    transactionNumber++;
    if (transactionNumber % 2 === 0) beforeApply?.();
    const backup = clone(store);
    try { return await work(client); } catch (error) { store = backup; throw error; }
  }) };
  const remote = {
    details: { ariveLoanId: 17881588, sysGUID: 'remote-guid', loanOriginatorEmail: 'matt@example.test', loanBorrowers: [{ applicantType: 'Borrower', firstName: 'TESTING', lastName: 'TESTER' }],
      currentLoanStatus: { status: 'APPLICATION_INTAKE', date: '2026-10-15', adverseReason: '' }, loanStatusHistory: [{ status: 'APPLICATION_INTAKE', date: '2026-10-15' }],
      keyDates: {}, modifiedDateTime: '2026-11-05T12:00:00Z', lockDate: null as string | null, lockExpirationDate: null as string | null },
    trackers: [tracker('TITLE', 'NOT_ORDERED'), tracker('HOI', 'NOT_ORDERED'), tracker('PAYOFFS', 'NOT_ORDERED'), tracker('APPRAISAL', 'NOT_ORDERED'), tracker('CD', 'NOT_SENT'), tracker('RATE_LOCK', 'None')],
    notes: [] as ObjectData[],
    notesFail: false,
    finalDetails: null as ObjectData | null,
  };
  let detailReads = 0;
  const api = vi.fn(async (path: string, body?: object, method?: 'PATCH') => {
    if (body || method) throw new Error('Unexpected outbound write');
    if (path.includes('searchField=')) return { rows: [{ ariveLoanId: 17881588, sysGUID: 'remote-guid' }] };
    if (path.endsWith('/trackers')) return { loanTrackers: clone(remote.trackers) };
    if (path.includes('/notes?')) { if (remote.notesFail) throw new AriveError('Arive notes unavailable.'); return { count: remote.notes.length, loanNotes: clone(remote.notes) }; }
    if (path === '/loans/remote-guid') { detailReads++; return clone(detailReads % 2 === 0 && remote.finalDetails ? remote.finalDetails : remote.details); }
    throw new Error('Unexpected read path');
  });
  const session = vi.fn(async () => api);
  const deps = { db: db as unknown as NonNullable<Parameters<typeof syncArivePipeline>[2]>['db'], session, now: () => new Date(time) };
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network access is forbidden in synchronization tests'); }));
  return { get store() { return store; }, client, db, remote, api, session, deps,
    setBeforeApply(fn: () => void) { beforeApply = fn; }, failPackage() { failPackageWrite = true; },
    advance(ms = 6 * 60_000) { time = new Date(time.getTime() + ms); }, run: () => syncArivePipeline('pipeline-test', { force: true }, deps),
  };
}
const rawNote = (text: string, id = 1) => ({ id, text, createdByName: 'Synthetic processor', createdAt: '2026-11-05T12:00:00Z', updatedAt: '2026-11-05T12:00:00Z', nestedNotes: [] });
afterEach(() => vi.unstubAllGlobals());

describe('inbound synchronization with real mapping, note import, and parsing', () => {
  it('imports stage, trackers and threaded notes atomically through remote GET calls only', async () => {
    const h = harness();
    h.remote.details.currentLoanStatus = { status: 'UNDERWRITING_SUBMITTED', date: '2026-11-01', adverseReason: '' };
    h.remote.trackers[0] = tracker('TITLE', 'RECEIVED', '2026-10-30');
    h.remote.notes = [{ ...rawNote('<p>Pending Items: paystubs</p>'), nestedNotes: [rawNote('Condition needed: verify income', 2)] }];
    expect(await h.run()).toMatchObject({ success: true, changed: true });
    expect(h.store.row).toMatchObject({ pipelineStatus: 'SUBBED_TO_UW', statusChangedAt: date('2026-11-01'), titleStatus: 'RECEIVED', missingItemsCurrentStatus: 'paystubs' });
    expect(h.store.task.submissionData.submissionPilot.ariveNotes.notes[0]).toMatchObject({ id: '1', replies: [{ id: '2', text: 'Condition needed: verify income' }] });
    expect(h.store.task.submissionData.submissionPilot.history).toEqual([{ message: 'Jr approved package' }]);
    expect(h.store.sync.snapshot.structuredValues).toMatchObject({ conditionNeeded: 'verify income' });
    expect(h.api.mock.calls.every(call => call[1] === undefined && call[2] === undefined)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not increment the pipeline version or duplicate applied audits for an identical refresh', async () => {
    const h = harness(); h.remote.notes = [rawNote('Pending Items: paystubs')];
    await h.run(); const version = h.store.row.version; const applied = h.store.audits.filter(a => a.action === 'PROCESSING_ARIVE_SYNC_APPLIED').length;
    const packageAfterFirst = clone(h.store.task); const packageWrites = h.client.task.updateMany.mock.calls.length;
    h.advance(); expect(await h.run()).toMatchObject({ success: true, changed: false });
    expect(h.store.row.version).toBe(version); expect(h.store.audits.filter(a => a.action === 'PROCESSING_ARIVE_SYNC_APPLIED')).toHaveLength(applied);
    expect(h.store.task).toEqual(packageAfterFirst); expect(h.client.task.updateMany).toHaveBeenCalledTimes(packageWrites);
  });
  it('records confirmed ownership even when the initial portal values already match Arive', async () => {
    const h = harness(); await h.run();
    expect(h.store.sync.snapshot.managed).toMatchObject({ titleStatus: 'NOT_STARTED', cdSent: false, rateLock: false });
    expect(h.store.sync.snapshot.managed).not.toHaveProperty('rateLockRequestedAt');
  });
  it('stores an allowlisted financial snapshot from the already-verified read without changing financial approvals', async () => {
    const h = harness(); const before = clone(h.store.row);
    Object.assign(h.remote.details, { baseLoanAmount: 250000, estCashToClose: 15000, backEndDTI: 34, ssn: 'DO_NOT_STORE', accountNumber: 'DO_NOT_STORE' });
    await h.run();
    expect(h.store.sync.snapshot.application).toMatchObject({ loan: { baseLoanAmount: 250000 }, financial: { estimatedCashToClose: 15000, backEndDti: 34 } });
    expect(JSON.stringify(h.store.sync.snapshot.application)).not.toContain('DO_NOT_STORE');
    for (const key of ['finalRevenue', 'projectedRevenue', 'payrollApproved', 'firstPaymentAt', 'sixthPaymentAt'] as const) expect(h.store.row[key]).toEqual(before[key]);
    expect(h.api.mock.calls.every(call => call[1] === undefined && call[2] === undefined)).toBe(true);
    h.advance(); expect(await h.run()).toMatchObject({ success: true, changed: false });
  });
  it.each([['ORDERED', true], ['WAIVED', false], ['COMPLETE', true]] as const)('uses successful source provenance to reverse the %s appraisal requirement inference', async (status, needed) => {
    const h = harness();
    h.remote.trackers[3] = tracker('APPRAISAL', status, '2026-11-05');
    await h.run(); expect(h.store.row.appraisalNeeded).toBe(needed);
    h.advance(); h.remote.trackers[3] = tracker('APPRAISAL', 'NOT_ORDERED');
    await h.run(); expect(h.store.row.appraisalNeeded).toBeNull();
    expect(h.store.sync.snapshot.managed).toMatchObject({ appraisalNeeded: null });
    const version = h.store.row.version;
    h.advance(); expect(await h.run()).toMatchObject({ success: true, changed: false });
    expect(h.store.row.version).toBe(version);
  });
  it.each([true, false])('keeps an independent appraisal requirement %s when Not Ordered has never implied a requirement', async appraisalNeeded => {
    const h = harness(); h.store.row.appraisalNeeded = appraisalNeeded;
    await h.run(); expect(h.store.row.appraisalNeeded).toBe(appraisalNeeded);
    h.advance(); await h.run(); expect(h.store.row.appraisalNeeded).toBe(appraisalNeeded);
    expect(h.store.sync.snapshot.managed).not.toHaveProperty('appraisalNeeded');
  });
  it.each(['unknown', 'duplicate', 'independent change'])('does not reset the appraisal requirement after %s interrupts source proof', async interruption => {
    const h = harness(); h.remote.trackers[3] = tracker('APPRAISAL', 'ORDERED', '2026-11-05');
    await h.run();
    if (interruption === 'independent change') h.store.row.appraisalNeeded = false;
    else {
      h.advance();
      if (interruption === 'unknown') h.remote.trackers[3] = tracker('APPRAISAL', 'UNFAMILIAR');
      else h.remote.trackers.push(tracker('APPRAISAL', 'WAIVED'));
      await h.run();
    }
    h.advance(); h.remote.trackers = h.remote.trackers.filter(t => t.name !== 'APPRAISAL'); h.remote.trackers.push(tracker('APPRAISAL', 'NOT_ORDERED'));
    await h.run(); expect(h.store.row.appraisalNeeded).toBe(interruption === 'independent change' ? false : true);
  });
  it.each(['SUSPENDED', 'LOAN_FUNDED', 'ADVERSE'])('routes %s while preserving financial and assignment records', async stage => {
    const h = harness(); const before = clone(h.store.row);
    h.remote.details.currentLoanStatus = { status: stage === 'ADVERSE' ? 'APPLICATION_INTAKE' : stage, date: '2026-11-01', adverseReason: stage === 'ADVERSE' ? 'APP_WITHDRAWN_BY_BORROWER' : '' };
    expect(await h.run()).toMatchObject({ success: true });
    if (stage === 'SUSPENDED') expect(h.store.row).toMatchObject({ sheet: 'RESTRUCTURE', pipelineStatus: 'SUSPENDED_RESTRUCTURE' });
    if (stage === 'LOAN_FUNDED') expect(h.store.row).toMatchObject({ sheet: 'FUNDING', pipelineStatus: 'FUNDED', fundedAt: date('2026-11-01') });
    if (stage === 'ADVERSE') expect(h.store.row.archivedAt).toBeInstanceOf(Date);
    for (const field of ['finalRevenue', 'projectedRevenue', 'firstPaymentAt', 'sixthPaymentAt', 'payrollApproved', 'seniorProcessorId', 'juniorProcessorId'] as const) expect(h.store.row[field]).toEqual(before[field]);
  });
  it('uses valid structured dates before deciding whether required dates are missing', async () => {
    const h = harness(); h.remote.details.currentLoanStatus.status = 'DOCS_OUT'; h.remote.trackers[2] = tracker('PAYOFFS', 'RECEIVED', '2026-11-01');
    h.remote.notes = [rawNote('Scheduled Signing: 11/08/2026\nPayoff Expiry: 2026-11-30')];
    await h.run(); expect(h.store.row.estimatedSigningAt).toEqual(date('2026-11-08')); expect(h.store.row.payoffExpiresAt).toEqual(date('2026-11-30'));
    expect(h.store.sync.issues.filter(i => ['estimatedSigningAt', 'payoffExpiresAt'].includes(String(i.field)))).toEqual([]);
  });
  it('explicit clears erase prior dates and create missing-date warnings instead of falling back to stale values', async () => {
    const h = harness(); h.store.row.estimatedSigningAt = date('2026-11-08'); h.store.row.payoffExpiresAt = date('2026-11-30');
    h.remote.details.currentLoanStatus.status = 'DOCS_OUT'; h.remote.trackers[2] = tracker('PAYOFFS', 'RECEIVED', '2026-11-01');
    h.remote.notes = [rawNote('Scheduled Signing: clear\nPayoff Expiry: none')];
    await h.run(); expect(h.store.row.estimatedSigningAt).toBeNull(); expect(h.store.row.payoffExpiresAt).toBeNull();
    expect(h.store.sync.issues.map(i => i.code)).toEqual(expect.arrayContaining(['MISSING_SIGNING_DATE', 'MISSING_PAYOFF_EXPIRY']));
  });
  it.each([null, '2026-11-04'])('does not clear a request for missing or stale confirmation %s', async lockDate => {
    const h = harness(); h.store.row.rateLockRequestedAt = date('2026-11-05T18:00:00Z'); h.store.row.rateLockRequestedById = 'requester';
    h.remote.trackers[5] = tracker('RATE_LOCK', 'Locked'); h.remote.details.lockDate = lockDate;
    await h.run(); expect(h.store.row.rateLockRequestedAt).toEqual(date('2026-11-05T18:00:00Z')); expect(h.store.row.rateLockRequestedById).toBe('requester');
    expect(h.store.audits.some(a => a.action === 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED')).toBe(false);
  });
  it('clears a same-day date-only lock only with an actual post-request unlocked snapshot', async () => {
    const h = harness(); h.store.row.rateLockRequestedAt = date('2026-11-05T18:00:00Z'); h.store.row.rateLockRequestedById = 'requester';
    await h.run(); h.advance(); h.remote.trackers[5] = tracker('RATE_LOCK', 'Locked'); h.remote.details.lockDate = '2026-11-05'; h.remote.details.lockExpirationDate = '2026-12-05';
    await h.run(); expect(h.store.row.rateLockRequestedAt).toBeNull(); expect(h.store.audits.filter(a => a.action === 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED')).toHaveLength(1);
  });
  it('does not treat retained old unlocked data as a new post-request observation when the tracker was unavailable', async () => {
    const h = harness(); await h.run();
    h.store.row.rateLockRequestedAt = date('2026-11-05T22:01:00Z'); h.store.row.rateLockRequestedById = 'requester';
    h.advance(); h.remote.trackers[5] = tracker('RATE_LOCK', 'UNFAMILIAR_STATUS'); await h.run();
    h.advance(); h.remote.trackers[5] = tracker('RATE_LOCK', 'Locked'); h.remote.details.lockDate = '2026-11-05'; h.remote.details.lockExpirationDate = '2026-12-05';
    await h.run(); expect(h.store.row.rateLockRequestedAt).toEqual(date('2026-11-05T22:01:00Z'));
    expect(h.store.audits.some(a => a.action === 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED')).toBe(false);
  });
  it('does not count an unlocked read started before a concurrent portal request as post-request evidence', async () => {
    const h = harness(); let injected = false;
    h.setBeforeApply(() => {
      if (injected) return; injected = true;
      h.store.row.rateLockRequestedAt = date('2026-11-05T22:01:00Z'); h.store.row.rateLockRequestedById = 'requester';
      h.advance(2 * 60_000); // First read began 22:00; the request arrived before its 22:02 commit.
    });
    await h.run(); h.advance();
    h.remote.trackers[5] = tracker('RATE_LOCK', 'Locked'); h.remote.details.lockDate = '2026-11-05'; h.remote.details.lockExpirationDate = '2026-12-05';
    await h.run();
    expect(h.store.row.rateLockRequestedAt).toEqual(date('2026-11-05T22:01:00Z'));
    expect(h.store.audits.some(a => a.action === 'PROCESSING_RATE_LOCK_REQUEST_FULFILLED')).toBe(false);
  });
});

describe('atomicity, identity, and worker fencing', () => {
  it('retains the pipeline when its document-package link changes while waiting for locks', async () => {
    const h = harness(); const before = clone(h.store.row);
    h.client.$executeRaw.mockImplementation(async (_sql, lockName) => {
      if (lockName === 'submission-pilot:package-test') h.store.row.sourceTask.submissionData.processingDocumentTaskId = 'replacement-package';
      return 1;
    });
    h.remote.details.currentLoanStatus.status = 'SUSPENDED';
    expect(await h.run()).toMatchObject({ success: false });
    expect(h.store.row).toEqual(before);
    expect(h.client.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(h.store.audits).toEqual([]);
  });
  it.each(['notes fail', 'wrong borrower', 'wrong originator', 'changed during read', 'older source'])('retains portal values on %s', async scenario => {
    const h = harness(); const before = clone(h.store.row); const priorPackage = clone(h.store.task);
    h.remote.trackers[0] = tracker('TITLE', 'RECEIVED', '2026-11-01');
    if (scenario === 'notes fail') h.remote.notesFail = true;
    if (scenario === 'wrong borrower') h.remote.details.loanBorrowers[0].firstName = 'ACTUAL';
    if (scenario === 'wrong originator') h.remote.details.loanOriginatorEmail = 'someoneelse@example.test';
    if (scenario === 'changed during read') h.remote.finalDetails = { ...h.remote.details, modifiedDateTime: '2026-11-05T13:00:00Z' };
    if (scenario === 'older source') h.store.sync.snapshot = { modifiedDateTime: '2026-11-05T13:00:00Z' };
    expect(await h.run()).toMatchObject({ success: false }); expect(h.store.row).toEqual(before); expect(h.store.task).toEqual(priorPackage);
    expect(h.store.audits).toEqual([]); expect(h.store.sync.failureCount).toBe(1); expect(h.store.sync.leaseToken).toBeNull();
  });
  it('rolls back already-issued row and audit writes if the document package changes before commit', async () => {
    const h = harness(); const before = clone(h.store.row); const pkg = clone(h.store.task); h.failPackage();
    h.remote.details.currentLoanStatus.status = 'SUSPENDED'; h.remote.notes = [rawNote('Pending Items: changed')];
    expect(await h.run()).toMatchObject({ success: false }); expect(h.client.processingPipelineLoan.updateMany).toHaveBeenCalled();
    expect(h.store.row).toEqual(before); expect(h.store.task).toEqual(pkg); expect(h.store.audits).toEqual([]); expect(h.store.sync.snapshot).toEqual({});
  });
  it.each(['paused', 'stale token', 'expired lease'])('fences a worker after %s without applying its result', async scenario => {
    const h = harness(); const before = clone(h.store.row);
    h.setBeforeApply(() => { if (scenario === 'paused') h.store.sync.enabled = false; if (scenario === 'stale token') h.store.sync.leaseToken = 'newer-worker'; if (scenario === 'expired lease') h.store.sync.leaseUntil = date('2026-11-05T21:59:59Z'); });
    expect(await h.run()).toMatchObject({ success: true, skipped: true }); expect(h.store.row).toEqual(before); expect(h.store.audits).toEqual([]);
    expect(h.client.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
  it('rejects another portal loan before claiming a lease or contacting Arive', async () => {
    const h = harness(); h.store.row.loan.borrowerName = 'Actual Client';
    await expect(h.run()).rejects.toThrow('limited'); expect(h.session).not.toHaveBeenCalled(); expect(h.client.arivePipelineSync.update).not.toHaveBeenCalled();
  });
  it('skips disabled, recently attempted, or leased files', async () => {
    const h = harness(); h.store.sync.enabled = false; expect(await h.run()).toMatchObject({ skipped: true });
    h.store.sync.enabled = true; h.store.sync.lastAttemptAt = date('2026-11-05T22:00:00Z'); expect(await h.run()).toMatchObject({ skipped: true });
    h.store.sync.lastAttemptAt = null; h.store.sync.leaseUntil = date('2026-11-05T22:03:00Z'); expect(await h.run()).toMatchObject({ skipped: true });
    expect(h.session).not.toHaveBeenCalled();
  });
  it('restricts due work to one enabled exact pilot file', async () => {
    const h = harness(); expect(await runDueArivePipelineSyncs(h.deps)).toEqual({ checked: 1, succeeded: 1, failed: 0 });
    expect(h.client.arivePipelineSync.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1, where: expect.objectContaining({ enabled: true, ariveLoanId: ARIVE_SYNC_PILOT.loanNumber, pipeline: { loanId: ARIVE_SYNC_PILOT.loanId, loan: { loanOfficerId: ARIVE_SYNC_PILOT.ownerId } } }) }));
  });
});
