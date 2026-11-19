import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('node:timers/promises', async importOriginal => {
  const timers = await importOriginal<typeof import('node:timers/promises')>();
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) };
});
import { setTimeout as waitForHint } from 'node:timers/promises';
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { runLeadershipPilotCollection } from './ariveLeadershipPilotWorker';
import { AriveTransportError } from './ariveTransport';
import { AriveError } from './ariveClient';
import { previousPilotReview } from './ariveLeadershipPilotReview';
import { stableAriveValue } from './ariveRollout';
import { createHash } from 'node:crypto';
import type { DiagnosticSource } from './ariveDiagnosticSource';
import { parsePilotChangeHints } from './ariveLeadershipPilotHints';
import { newNoteEvidence } from './ariveLeadershipPilotProjection';

// No live-work mutation methods are supplied. The worker can only update the
// Pilot row and Pilot revision, even when a remote stage would move a loan.
function harness() {
  const revision = new Date('2026-04-01');
  let clock = new Date('2026-04-15T12:00:00Z');
  const control = { enabled: true, generation: 1, cohortLimit: 10 };
  const loan = {
    id: 'test-loan',
    loanNumber: '801',
    borrowerName: 'Synthetic Borrower',
    borrowerFirstName: 'Synthetic',
    borrowerLastName: 'Borrower',
    loanOfficer: { email: 'officer@example.test' },
    secondaryLoanOfficer: null,
    payrollCompRequests: [],
    amount: 150000,
    program: 'Original',
    propertyAddress: null,
    borrowerPhone: null,
    borrowerEmail: null,
  };
  const pipeline = {
    id: 'file',
    loanId: loan.id,
    loan,
    ariveSync: null,
    sheet: 'PIPELINE',
    pipelineStatus: 'PENDING_APPROVAL',
    version: 4,
    statusChangedAt: revision,
    archivedAt: null,
    archivedById: null,
    movedAt: null,
    fundedAt: null,
    firstPaymentAt: null,
    sixthPaymentAt: null,
    rateLockRequestedAt: null,
    rateLockRequestedById: null,
    estimatedSigningAt: null,
    payoffExpiresAt: null,
  };
  const row: Record<string, unknown> = {
    pipelineId: 'file',
    pipeline,
    ariveLoanId: '801',
    ariveGuid: null,
    snapshot: {},
    notes: [],
    routingProvenance: {},
    projectionVersion: 0,
    collectedAt: null,
    leaseToken: null,
    leaseUntil: null,
    failureCount: 0,
    manualRefreshRequestedAt: null,
    watchedUntil: null,
  };
  function patch(data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data))
      row[key] =
        value && typeof value === 'object' && 'increment' in value
          ? Number(row[key] ?? 0) + Number(value.increment)
          : value;
  }
  const pilotAriveProjection = {
    count: vi.fn(async () => 0),
    findFirst: vi.fn(async (): Promise<typeof row | null> => structuredClone(row)),
    findUnique: vi.fn(async () => structuredClone(row)),
    update: vi.fn(async ({ data }) => patch(data)),
    updateMany: vi.fn(async ({ data }) => {
      patch(data);
      return { count: 1 };
    }),
  };
  const db = {
    pilotAriveProjection,
    pilotAriveControl: { findUnique: vi.fn(async () => control), update: vi.fn() },
    ariveIntegrationConfig: { findUnique: vi.fn(async () => ({ updatedAt: revision })) },
    loan: { count: vi.fn(async () => 1) },
    arivePracticeLoan: { findFirst: vi.fn().mockResolvedValue(null) },
    task: { findUnique: vi.fn() },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async (parts: TemplateStringsArray): Promise<Record<string, unknown>[]> => {
      const sql = parts.join('?');
      if (sql.includes('slots.active')) return control.enabled
        ? [{ generation: control.generation, cohortLimit: control.cohortLimit, revision, active: 0, reserved: 0 }]
        : [];
      if (sql.includes('FOR SHARE OF a,p,l')) return control.enabled ? [{ generation: control.generation, revision }] : [];
      return [];
    }),
    $transaction: vi.fn(async (work) => work(db)),
  };
  const details = {
    ariveLoanId: '801',
    sysGUID: 'test-guid',
    loanOriginatorEmail: loan.loanOfficer.email,
    loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Borrower' }],
    archiveIndicator: false,
    currentLoanStatus: { status: 'SUSPENDED', date: '2026-04-10' },
    loanStatusHistory: [],
    totalLoanAmount: 153000,
    modifiedDateTime: '2026-04-14T00:00:00Z',
  };
  const providerNotes = [
    {
      id: 'note1',
      text: 'Pending Items: paystub',
      createdAt: '2026-04-14T00:00:00Z',
      updatedAt: '2026-04-14T00:00:00Z',
      nestedNotes: [],
    },
  ];
  const api = vi.fn(async (path: string) => {
    if (path.startsWith('/loans?')) return { count: 1, rows: [{ ariveLoanId: '801', sysGUID: 'test-guid' }] };
    if (path.endsWith('/trackers')) return { loanTrackers: [] };
    if (path.includes('/notes?')) return { loanNotes: providerNotes, count: providerNotes.length };
    return details;
  });
  const run = () =>
    runLeadershipPilotCollection({
      pipelineId: 'file',
      db: db as never,
      session: async () => api as never,
      now: () => new Date(clock),
    });
  return {
    db,
    row,
    control,
    pipeline,
    details,
    providerNotes,
    api,
    run,
    advance: () => {
      clock = new Date(+clock + 60_000);
    },
    advanceMs: (milliseconds: number) => { clock = new Date(+clock + milliseconds); },
  };
}
describe('leadership-only collection', () => {
  it('holds current review evidence, distinguishes 403 from an empty search, and never treats past verification as Pilot enrollment', () => {
    const source = { id: 'p1', loanId: 'loan1', version: 2, loan: { loanNumber: '801' } } as DiagnosticSource;
    const revision = new Date('2026-04-15T00:00:00Z');
    const canonical = {
      ariveLoanId: '801',
      enrollmentStatus: 'REVIEW',
      enrollmentIssue: 'zero loans',
      updatedAt: revision,
    };
    const prior = {
      pipelineId: 'p1',
      loanId: 'loan1',
      number: '801',
      sourceHash: createHash('sha256').update(stableAriveValue(source)).digest('hex'),
      outcome: 'NO_API_MATCH',
      searchStatus: '200',
      detailStatus: null,
      probeStatus: '403',
    };
    expect(previousPilotReview(source, canonical, prior, revision)).toMatch(/no exact/);
    expect(previousPilotReview(source, canonical, { ...prior, detailStatus: '403' }, revision)).toMatch(/matched loan ID.*403/);
    expect(previousPilotReview(source, canonical, { ...prior, searchStatus: '403' }, revision)).toMatch(/branch loan search.*403/);
    expect(previousPilotReview(source, canonical, { ...prior, probeStatus: null }, revision)).toMatch(/no exact/);
    expect(
      previousPilotReview(source, canonical, { ...prior, outcome: 'MATCHED', probeStatus: null }, revision),
    ).toBeNull();
    expect(previousPilotReview({ ...source, version: 3 }, canonical, prior, revision)).toBeNull();
    expect(previousPilotReview(source, canonical, undefined, revision)).toMatch(/no exact/);
    expect(previousPilotReview(source, { ...canonical, updatedAt: new Date(0) }, undefined, revision)).toBeNull();
  });
  it.each([
    { rows: [], category: 'No exact loan number' },
    { rows: [{ ariveLoanId: '801', sysGUID: 'first' }, { ariveLoanId: '801', sysGUID: 'second' }], category: 'multiple files' },
    { rows: [{ ariveLoanId: '801', sysGUID: '' }], category: 'Missing a valid permanent Arive loan ID' },
  ])('reports the actual branch matching outcome without guessing an identity: $category', async ({ rows, category }) => {
    const h = harness();
    h.api.mockResolvedValueOnce({ count: rows.length, rows });
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', enrollmentIssue: expect.stringContaining(category) });
    expect(h.api).toHaveBeenCalledTimes(1);
  });
  it('keeps an unchanged revision and original note evidence through later successful heartbeats', async () => {
    const h = harness();
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    h.advance();
    const createdAt = '2026-04-15T12:00:50Z';
    h.providerNotes.push({ id: 'second', text: 'Synthetic note', createdAt, updatedAt: createdAt, nestedNotes: [] });
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    const snapshot = structuredClone(h.row.snapshot);
    expect(snapshot).toMatchObject({
      noteChangeEvidence: [{ noteId: 'second', createdAt }],
      publishedAt: '2026-04-15T12:01:00.000Z',
    });
    h.advance();
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    expect(h.row).toMatchObject({ snapshot, projectionVersion: 2, collectedAt: new Date('2026-04-15T12:02:00Z') });
    expect(h.db.pilotAriveControl.update).toHaveBeenCalledTimes(2);
  });
  it('retains the legal borrower only in the Pilot and rechecks original facts before publishing each read', async () => {
    const h = harness();
    Object.assign(h.pipeline.loan, { propertyAddress: '1 Example St, Example City, CA 90000', borrowerPhone: '2025550142' });
    Object.assign(h.details, { baseLoanAmount: 150000, subjectProperty: {
      addressLineText: '1 Example Street', city: 'Example City', state: 'CA', postalCode: '90000',
    } });
    const applicant = h.details.loanBorrowers[0];
    Object.assign(applicant, { middleName: 'Borrower', lastName: 'Sample', mobilePhone10digit: '2025550142' });
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    expect(h.row).toMatchObject({ identityHash: expect.stringMatching(/^middle-name:/), enrollmentStatus: 'VERIFIED',
      snapshot: { borrowerIdentityMethod: 'VERIFIED_MIDDLE_NAME', canonicalLoan: {borrowerName: 'Synthetic Sample'} } });
    expect(h.pipeline.loan.borrowerName).toBe('Synthetic Borrower');
    h.advance();
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    h.advance();
    applicant.lastName = 'Different';
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', snapshot: { canonicalLoan: {borrowerName:'Synthetic Sample'} } });
    expect(h.pipeline.loan.borrowerLastName).toBe('Borrower');
  });
  it('does not take a lease when the worker has insufficient time for a complete read', async () => {
    const h = harness();
    expect(await runLeadershipPilotCollection({ db: h.db as never, deadlineMs: Date.now() + 5_000 })).toMatchObject({
      checked: 0,
      succeeded: 0,
    });
    expect(h.db.pilotAriveProjection.findFirst).not.toHaveBeenCalled();
  });
  it('reserves a sweep for scheduled updates while admitting new active files ahead of recent fundings', async () => {
    const h = harness();
    Object.assign(h.control, { cohortLimit: null, lastHintScanAt: new Date() });
    const findFirst = vi.fn().mockResolvedValue(null);
    const db = {
      ...h.db, processingPipelineLoan: { findMany: vi.fn().mockResolvedValue([]) },
      pilotAriveProjection: { ...h.db.pilotAriveProjection, findFirst },
    };
    db.$transaction.mockImplementation(async work => work(db));
    const session = vi.fn();
    await runLeadershipPilotCollection({ db: db as never, session });
    const orders = findFirst.mock.calls.map(([query]) => query.orderBy);
    const tieBreakers = [{ pipeline: { sheet: 'asc' } }, { createdAt: 'asc' }, { pipelineId: 'asc' }];
    const refreshOrder = [{ nextAttemptAt: { sort: 'asc', nulls: 'last' } }, ...tieBreakers];
    expect(orders).toContainEqual(refreshOrder);
    expect(orders).toContainEqual([{ nextAttemptAt: { sort: 'asc', nulls: 'first' } }, ...tieBreakers]);
    expect(orders).toContainEqual([
      { manualRefreshRequestedAt: { sort: 'asc', nulls: 'last' } },
      { hintRequestedAt: { sort: 'asc', nulls: 'last' } },
      ...refreshOrder,
    ]);
    expect(session).not.toHaveBeenCalled();
  });
  it('wakes at the database scan deadline while a full-volume file is busy and cancels its timer on completion', async () => {
    const h = harness();
    let now = new Date();
    Object.assign(h.control, { cohortLimit: null, lastHintScanAt: new Date(+now - 15_000) });
    let claimed = false;
    const findFirst = vi.fn(async (query: { select?: { pipelineId: boolean } }) => {
      if (query.select?.pipelineId) return { pipelineId: 'file' };
      if (claimed) return null;
      claimed = true;
      return structuredClone(h.row);
    });
    const db = { ...h.db, processingPipelineLoan: { findMany: vi.fn(async () => []) },
      pilotAriveProjection: { ...h.db.pilotAriveProjection, findFirst } };
    db.$transaction.mockImplementation(async work => work(db));
    let finishFile!: () => void, wake!: () => void;
    const fileGate = new Promise<void>(resolve => { finishFile = resolve; });
    const wakeGate = new Promise<void>(resolve => { wake = resolve; });
    const sleeping = vi.mocked(waitForHint);
    sleeping.mockClear();
    sleeping.mockImplementationOnce(() => wakeGate);
    const api = vi.fn(async (path: string) => {
      if (path.includes('orderBy=updatedAt')) return { count: 0, rows: [] };
      await fileGate;
      return h.api(path);
    });
    const run = runLeadershipPilotCollection({ db: db as never, now: () => now, session: async () => api as never });
    await vi.waitFor(() => expect(sleeping).toHaveBeenCalledWith(5_000, undefined, expect.anything()));
    now = new Date(+now + 5_000);
    wake();
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('/loans?limit=100&offset=0&orderBy=updatedAt&sort=DESC'));
    finishFile();
    await run;
    expect(sleeping.mock.calls[0][2]?.signal?.aborted).toBe(true);
  });
  it.each([{ limit: 50, slots: 2 }, { limit: null, slots: 4 }])(
    'stages $slots independent file reads at cohort $limit while honoring one lease per file', async ({ limit, slots }) => {
      const h = harness();
      Object.assign(h.control, { cohortLimit: limit, lastHintScanAt: new Date() });
      const db = { ...h.db, processingPipelineLoan: { findMany: vi.fn(async () => []) } };
      db.$transaction.mockImplementation(async work => work(db));
      let claimed = 0;
      h.db.pilotAriveProjection.findFirst.mockImplementation(async () => {
        if (claimed === slots) return null;
        return { ...structuredClone(h.row), pipelineId: 'file-' + ++claimed };
      });
      let release!: () => void;
      const resume = new Promise<void>(resolve => { release = resolve; });
      const session = vi.fn(async () => async (path: string) => {
        await resume;
        return h.api(path);
      });
      const running = runLeadershipPilotCollection({ db: db as never, session: session as never });
      await vi.waitFor(() => expect(session).toHaveBeenCalledTimes(slots));
      const leased = h.db.pilotAriveProjection.update.mock.calls
        .filter(([query]) => query.data.leaseToken).map(([query]) => query.where.pipelineId);
      expect(new Set(leased).size).toBe(slots);
      release();
      await running;
    },
  );
  it.each([
    { limit: 50, active: 2, admitted: false },
    { limit: null, active: 3, admitted: true },
    { limit: null, active: 4, admitted: false },
  ])('rechecks the global file cap against overlapping invocations: $limit / $active', async ({ limit, active, admitted }) => {
    const h = harness();
    const query = h.db.$queryRaw.getMockImplementation()!;
    h.db.$queryRaw.mockImplementation(async parts => parts.join('?').includes('slots.active')
      ? [{ generation: 1, cohortLimit: limit, revision: new Date('2026-04-01'), active, reserved: active }]
      : query(parts));
    expect((await h.run()).checked).toBe(admitted ? 1 : 0);
    expect(h.api.mock.calls.length > 0).toBe(admitted);
  });
  it('lets the other lane finish the queue after a local HTTP slot timeout and reuses its session', async () => {
    const h = harness();
    Object.assign(h.control, { lastHintScanAt: new Date() });
    const db = { ...h.db, processingPipelineLoan: { findMany: vi.fn(async () => []) } };
    db.$transaction.mockImplementation(async work => work(db));
    let claimed = 0;
    h.db.pilotAriveProjection.findFirst.mockImplementation(async () => claimed < 4
      ? { ...structuredClone(h.row), pipelineId: 'queued-' + ++claimed } : null);
    const session = vi.fn()
      .mockResolvedValueOnce(async () => { throw new AriveTransportError('BUSY', 'Both HTTP slots are in use.'); })
      .mockResolvedValue(async (path: string) => {
        await new Promise<void>(resolve => setImmediate(resolve));
        return h.api(path);
      });
    const summary = await runLeadershipPilotCollection({ db: db as never, session });
    expect(summary).toMatchObject({ checked: 4, deferred: 1 });
    expect(session).toHaveBeenCalledTimes(2);
  });
  it('shares one standby and claims the due file as soon as the previous cron releases both leases', async () => {
    const h = harness();
    const db = {
      ...h.db,
      processingPipelineLoan: { findMany: vi.fn(async () => []) },
    };
    Object.assign(h.control, {lastHintScanAt: new Date()});
    let occupied = true, handedOff = false;
    const prior = h.db.$queryRaw.getMockImplementation()!;
    h.db.$queryRaw.mockImplementation(async parts => {
      const sql = parts.join('?');
      if (sql.includes('AS open')) return [{open: !occupied}];
      if (sql.includes('slots.active') && occupied) return [{
        generation: 1, cohortLimit: 10, revision: new Date('2026-04-01'), active: 2, reserved: 10,
      }];
      return prior(parts);
    });
    db.$transaction.mockImplementation(async work => work(db));
    db.pilotAriveProjection.findFirst.mockImplementation(async () => {
      if (occupied || handedOff) return null;
      handedOff = true;
      return structuredClone(h.row);
    });
    // Yield one event-loop turn so both simulated lanes encounter the two
    // old leases before their owner exits. No real timer or network call.
    const sleep = vi.fn(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      occupied = false;
    });
    const result = await runLeadershipPilotCollection({db: db as never, session: async () => h.api as never, sleep});
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(6000);
    expect(result).toMatchObject({checked: 1, succeeded: 1});
    expect(h.row.enrollmentStatus).toBe('VERIFIED');
  });
  it('does not wait for occupied slots when no verified active file needs the handoff', async () => {
    const h = harness();
    Object.assign(h.control, { lastHintScanAt: new Date() });
    const db = { ...h.db, processingPipelineLoan: { findMany: vi.fn(async () => []) } };
    db.$transaction.mockImplementation(async work => work(db));
    h.db.$queryRaw.mockImplementation(async parts => parts.join('?').includes('slots.active') ? [{
      generation: 1, cohortLimit: 10, revision: new Date('2026-04-01'), active: 2, reserved: 10,
    }] : []);
    const sleep = vi.fn();
    expect(await runLeadershipPilotCollection({db: db as never, session: async () => h.api as never, sleep})).toMatchObject({checked: 0});
    expect(sleep).not.toHaveBeenCalled();
    expect(h.api).not.toHaveBeenCalled();
  });
  it('records exact note creation times only for new uniquely identifiable notes and replies after baseline', () => {
    const sampledAt = new Date('2026-04-10T12:00:00Z');
    const note = {
      id: 'new',
      author: 'tester',
      text: 'Synthetic note',
      createdAt: '2026-04-10T11:59:53Z',
      updatedAt: '',
      replies: [],
    };
    const old = { ...note, id: 'old' };
    expect(newNoteEvidence(null, [note], sampledAt)).toEqual([]);
    expect(newNoteEvidence([old], [{ ...old, text: 'Changed', replies: [note] }], sampledAt)).toEqual([
      { noteId: 'new', parentNoteId: 'old', createdAt: note.createdAt },
    ]);
    expect(
      newNoteEvidence(
        [],
        [
          note,
          note,
          { ...note, id: 'future', createdAt: '2026-04-15T00:00:00Z' },
          { ...note, id: 'day', createdAt: '2026-04-10' },
        ],
        sampledAt,
      ),
    ).toEqual([]);
  });
  it.each([true, false])('verifies the same-loan test package, registered practice = %s', async (registered) => {
    const h = harness();
    Object.assign(h.pipeline, { sourceTaskId: 'request' });
    h.db.arivePracticeLoan.findFirst.mockResolvedValue(
      registered
        ? {
            enabled: true,
            label: 'Leadership test submission',
            createdById: 'leader',
            ariveLoanId: '801',
            ariveGuid: 'test-guid',
          }
        : null,
    );
    const doc = {
      kind: null,
      title: 'Processing submission pilot — documents',
      loanId: 'test-loan',
      submissionData: {
        submissionPilot: {
          version: 1,
          items: [],
          leadershipTest: true,
          leadershipSubmitterId: 'leader',
          ariveLink: { id: 'test-guid', loanNumber: '801' },
        },
      },
    };
    h.db.task.findUnique.mockImplementation(async ({ where }) =>
      where.id === 'request'
        ? {
            kind: 'SUBMIT_PROCESSING',
            loanId: 'test-loan',
            submissionData: { leadershipPilotTest: true, processingDocumentTaskId: 'document' },
          }
        : doc,
    );
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    h.advance();
    doc.submissionData.submissionPilot.ariveLink.id = 'different';
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ enrollmentStatus: registered ? 'EXCLUDED' : 'REVIEW', projectionVersion: 1 });
  });
  it('only schedules usable, exact number/GUID change hints and rejects ambiguity and incomplete pages', () => {
    const a = { ariveLoanId: '801', sysGUID: 'guid-a', modifiedDateTime: '2026-04-10T11:00:00Z' };
    const b = { ariveLoanId: '802', sysGUID: 'guid-b', modifiedDateTime: '2026-04-10T11:01:00Z' };
    expect(
      parsePilotChangeHints({
        count: 4,
        rows: [a, b, { ...a, sysGUID: 'wrong' }, { ...b, modifiedDateTime: 'invalid' }],
      }),
    ).toEqual([{ number: '802', guid: 'guid-b', modified: new Date(b.modifiedDateTime), stage: null }]);
    expect(parsePilotChangeHints({ count: 0, rows: [a] })).toEqual([]);
    expect(parsePilotChangeHints({ count: 300, rows: [] })).toEqual([]);
  });
  it('persists a complete projection, restores its own restructure next cycle, and preserves staff records', async () => {
    const h = harness(),
      original = structuredClone(h.pipeline);
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    expect(h.row).toMatchObject({
      enrollmentStatus: 'VERIFIED',
      sheet: 'RESTRUCTURE',
      projectionVersion: 1,
      snapshot: { managed: { missingItemsCurrentStatus: 'paystub' }, canonicalLoan: { amount: 153000 } },
      notes: [{ id: 'note1' }],
    });
    h.advance();
    h.details.currentLoanStatus = { status: 'CLEAR_TO_CLOSE', date: '2026-04-15' };
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    expect(h.row).toMatchObject({ sheet: 'PIPELINE', pipelineStatus: 'CTC', projectionVersion: 2 });
    expect(h.pipeline).toEqual(original);
    expect(h.api.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
  it('retains the last complete snapshot on partial reads and honors transport cooldown', async () => {
    const h = harness();
    await h.run();
    const saved = structuredClone(h.row.snapshot);
    h.advance();
    const retry = new Date('2026-04-15T13:00:00Z');
    h.api.mockRejectedValueOnce(new AriveTransportError('COOLDOWN', 'Retry later.', retry));
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ snapshot: saved, projectionVersion: 1, nextAttemptAt: retry, leaseToken: null });
  });
  it('does not publish after pause during a multi-request read', async () => {
    const h = harness();
    const original = h.api.getMockImplementation()!;
    h.api.mockImplementation(async (path) => {
      if (path.endsWith('/trackers')) h.control.enabled = false;
      return original(path);
    });
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ snapshot: {}, notes: [], collectedAt: null, leaseToken: null });
  });
  it('counts time spent reading against the watch interval and rereads a concurrent edit promptly', async () => {
    const h = harness();
    h.row.watchedUntil = new Date('2026-04-15T13:00:00Z');
    const provider = h.api.getMockImplementation()!;
    h.api.mockImplementation(async path => {
      if (path.endsWith('/trackers')) h.advanceMs(12_000);
      return provider(path);
    });
    expect(await h.run()).toMatchObject({ succeeded: 1 });
    expect(h.row.nextAttemptAt).toEqual(h.row.collectedAt);
    const previous = structuredClone(h.row.snapshot);
    let reads = 0;
    h.api.mockImplementation(async path => {
      if (path === '/loans/test-guid' && ++reads === 2) return { ...h.details, totalLoanAmount: 160000 };
      return provider(path);
    });
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({
      snapshot: previous, projectionVersion: 1,
      lastError: expect.stringContaining('changed during this read'),
      nextAttemptAt: new Date('2026-04-15T12:00:14Z'),
    });
  });
  it('does not publish another borrower or consume API calls while paused', async () => {
    const h = harness();
    h.control.enabled = false;
    expect(await h.run()).toMatchObject({ checked: 0 });
    expect(h.api).not.toHaveBeenCalled();
    h.control.enabled = true;
    h.details.loanBorrowers[0].lastName = 'Other';
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', projectionVersion: 0, notes: [] });
  });
  it.each([403, 404])('records HTTP %s distinctly and retains its last complete version privately', async code => {
    const h = harness();
    await h.run();
    h.advance();
    h.api.mockRejectedValueOnce(new AriveError(`Arive API request returned HTTP ${code}. Request failed.`));
    expect(await h.run()).toMatchObject({ succeeded: 0 });
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', enrollmentIssue: expect.stringContaining(`HTTP ${code}`), projectionVersion: 1 });
  });
  it('tags an initial denial with its checked identity and revision, never re-labeling a prior snapshot', async () => {
    const h = harness();
    const denied = new AriveError('Arive API request returned HTTP 403.');
    h.api.mockRejectedValueOnce(denied);
    await h.run();
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', collectedAt: null, identityHash: expect.any(String),
      connectionRevision: new Date('2026-04-01'), ariveLoanId: '801' });
    await h.run();
    const previousConnection = new Date('2026-03-01');
    Object.assign(h.row, { connectionRevision: previousConnection });
    h.api.mockRejectedValueOnce(denied);
    await h.run();
    expect(h.row).toMatchObject({ enrollmentStatus: 'REVIEW', connectionRevision: previousConnection, projectionVersion: 1 });
  });
  it('does not store review evidence when the live identity changed while Arive was responding', async () => {
    const h = harness();
    h.api.mockImplementationOnce(async () => {
      h.pipeline.loan.loanNumber = '802';
      throw new AriveError('Arive API request returned HTTP 403.');
    });
    await h.run();
    expect(h.row.enrollmentIssue).toBeUndefined();
    expect(h.row.identityHash).toBeUndefined();
    expect(h.row).toMatchObject({ collectedAt: null, leaseToken: null });
  });
});
