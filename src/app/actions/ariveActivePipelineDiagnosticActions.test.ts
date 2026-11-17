import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  session: vi.fn(), user: vi.fn(), control: vi.fn(), config: vi.fn(), rows: vi.fn(), row: vi.fn(), count: vi.fn(), practice: vi.fn(),
  auditFirst: vi.fn(), auditUnique: vi.fn(), auditCreate: vi.fn(), auditUpdate: vi.fn(), auditUpdateMany: vi.fn(), auditMany: vi.fn(),
  transaction: vi.fn(), lock: vi.fn(), budget: vi.fn(), chunk: vi.fn(), forbiddenWrite: vi.fn(),
}));
const errors = vi.hoisted(() => ({
  AriveError: class AriveError extends Error {},
  GuardError: class AriveActiveDiagnosticGuardError extends Error {
    constructor(public code: string) { super(code); }
  },
}));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveTransport', async () => import('../../lib/ariveTransport'));
vi.mock('@/lib/ariveSyncTypes', async () => import('../../lib/ariveSyncTypes'));
vi.mock('@/lib/ariveRollout', () => ({ stableAriveValue: (value: unknown) => JSON.stringify(value) }));
vi.mock('@/lib/ariveClient', () => ({ AriveError: errors.AriveError }));
vi.mock('@/lib/ariveTransportPrisma', () => ({
  isAriveBudgetReady: m.budget,
  sharedAriveTransportEnabled: () => process.env.ARIVE_SHARED_TRANSPORT_ENABLED === 'true',
}));
vi.mock('@/lib/ariveActivePipelineDiagnostic', () => ({
  runAriveActivePipelineDiagnosticChunk: m.chunk,
  AriveActiveDiagnosticGuardError: errors.GuardError,
}));
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: m.user },
  ariveRolloutControl: { findUnique: m.control, update: m.forbiddenWrite, upsert: m.forbiddenWrite },
  ariveIntegrationConfig: { findUnique: m.config, update: m.forbiddenWrite },
  processingPipelineLoan: { findMany: m.rows, findUnique: m.row, count: m.count, update: m.forbiddenWrite, updateMany: m.forbiddenWrite },
  arivePracticeLoan: { findMany: m.practice, update: m.forbiddenWrite },
  arivePipelineSync: { count: m.count, update: m.forbiddenWrite, updateMany: m.forbiddenWrite, upsert: m.forbiddenWrite },
  loan: { update: m.forbiddenWrite, updateMany: m.forbiddenWrite },
  task: { create: m.forbiddenWrite, update: m.forbiddenWrite, updateMany: m.forbiddenWrite },
  notification: { create: m.forbiddenWrite, createMany: m.forbiddenWrite },
  auditLog: { findFirst: m.auditFirst, findUnique: m.auditUnique, findMany: m.auditMany, create: m.auditCreate, update: m.auditUpdate, updateMany: m.auditUpdateMany },
  $transaction: m.transaction,
} }));

// Lifecycle and race regressions below use only synthetic loan identities.
import { cancelActivePipelineDiagnostic, continueActivePipelineDiagnostic, getActivePipelineDiagnostic, startActivePipelineDiagnostic, startActivePipelineDiagnosticFollowUp } from './ariveActivePipelineDiagnosticActions';
import type { AriveActiveDiagnosticChunkInput, AriveActiveDiagnosticChunkResult } from '@/lib/ariveActivePipelineDiagnostic';

const ACTION = 'ARIVE_ACTIVE_PIPELINE_DIAGNOSTIC';
const NOW = new Date('2026-11-17T19:00:00.000Z');
type Audit = { id: string; action: string; details: string; userId: string; createdAt: Date };
function source(index = 1) {
  return {
    id: `pipeline-${index}`, loanId: `loan-${index}`, sheet: 'PIPELINE', archivedAt: null as Date | null, version: 3,
    loan: { id: `loan-${index}`, loanNumber: `${99000000 + index}`, borrowerName: `Synthetic Person ${index}`,
      borrowerFirstName: 'Synthetic', borrowerLastName: `Person ${index}`, updatedAt: NOW,
      loanOfficer: { name: 'Synthetic Officer', email: 'officer@example.test' }, secondaryLoanOfficer: null as { email: string } | null },
    ariveSync: { ariveGuid: `guid-${index}`, verifiedOriginatorEmail: 'officer@example.test' },
  };
}
let state: ReturnType<typeof initial>;
let audits: Audit[];
let sequence: number;
function initial() {
  return {
    sources: [source()],
    control: { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, generation: 7 },
    config: { encryptedCredentials: 'encrypted-private-connection', updatedAt: new Date('2026-11-17T18:00:00.000Z') },
    actor: { id: 'admin', active: true, role: 'ADMIN_III', roles: [] as string[] },
    session: { user: { id: 'admin', role: 'ADMIN_III', activeRole: undefined as string | undefined } },
    running: 0,
  };
}
function clone<T>(value: T): T { return structuredClone(value); }
function latest() { return [...audits].filter(row => row.action === ACTION).at(-1) ?? null; }
function persisted() {
  const row = latest();
  if (!row) throw new Error('Expected a saved diagnostic');
  return JSON.parse(row.details);
}
function rewrite(update: (value: ReturnType<typeof persisted>) => void) {
  const row = latest();
  if (!row) throw new Error('Expected a saved diagnostic');
  const value = persisted(); update(value); row.details = JSON.stringify(value);
}
async function start() {
  const result = await startActivePipelineDiagnostic();
  if (!result.success || !result.run) throw new Error('Synthetic diagnostic did not start');
  return result.run;
}
function completed(input: AriveActiveDiagnosticChunkInput): AriveActiveDiagnosticChunkResult {
  return {
    results: input.loans.map(loan => ({ pipelineId: loan.pipelineId, loanNumber: loan.loanNumber, version: loan.version,
      synthetic: loan.synthetic === true, checkedAt: new Date().toISOString(), status: 'VERIFIED', phase: 'DETAIL', apiVisible: true,
      searchIdentity: true, detailIdentity: true, identityIssue: null, httpStatus: 200, gatewayCode: null })),
    consumed: input.loans.length, getRequests: input.loans.length * 2, authenticationRequests: 0, deferred: null, invalidated: false,
  };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); state = initial(); audits = []; sequence = 0;
  vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('ARIVE_SHARED_TRANSPORT_ENABLED', 'true');
  vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'false'); vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', 'false');
  m.session.mockImplementation(async () => clone(state.session)); m.user.mockImplementation(async () => clone(state.actor));
  m.control.mockImplementation(async () => clone(state.control)); m.config.mockImplementation(async () => clone(state.config));
  m.count.mockImplementation(async () => state.running); m.practice.mockResolvedValue([]);
  m.budget.mockResolvedValue({ ready: true, reason: null });
  m.rows.mockImplementation(async (args: { where?: { id?: { in: string[] }; sheet?: string; archivedAt?: null; loan?: { loanNumber: { in: string[] } } }; take?: number }) => {
    const where = args.where;
    const rows = state.sources.filter(row => (!where?.id || where.id.in.includes(row.id))
      && (!where?.sheet || row.sheet === where.sheet)
      && (where?.archivedAt !== null || row.archivedAt === null)
      && (!where?.loan || where.loan.loanNumber.in.includes(row.loan.loanNumber)));
    return clone(args.take === undefined ? rows : rows.slice(0, args.take));
  });
  m.row.mockImplementation(async (args: { where: { id: string } }) => clone(state.sources.find(row => row.id === args.where.id) ?? null));
  m.auditFirst.mockImplementation(async () => clone(latest()));
  m.auditUnique.mockImplementation(async (args: { where: { id: string } }) => clone(audits.find(row => row.id === args.where.id) ?? null));
  m.auditMany.mockImplementation(async () => clone(audits));
  m.auditCreate.mockImplementation(async (args: { data: { action: string; details: string; userId: string; id?: string } }) => {
    const row: Audit = { id: args.data.id ?? `run-${++sequence}`, ...args.data, createdAt: new Date(Date.now() + sequence) };
    audits.push(clone(row)); return clone(row);
  });
  m.auditUpdate.mockImplementation(async (args: { where: { id: string }; data: { details: string } }) => {
    const row = audits.find(value => value.id === args.where.id);
    if (!row) throw new Error('Synthetic audit missing');
    row.details = args.data.details; return clone(row);
  });
  m.auditUpdateMany.mockImplementation(async (args: { where: { id: string }; data: { details: string } }) => {
    const row = audits.find(value => value.id === args.where.id);
    if (!row) return { count: 0 };
    row.details = args.data.details; return { count: 1 };
  });
  m.transaction.mockImplementation(async work => work({
    $executeRaw: m.lock,
    ariveRolloutControl: { findUnique: m.control, update: m.forbiddenWrite, upsert: m.forbiddenWrite },
    ariveIntegrationConfig: { findUnique: m.config, update: m.forbiddenWrite },
    arivePipelineSync: { count: m.count, update: m.forbiddenWrite, updateMany: m.forbiddenWrite, upsert: m.forbiddenWrite },
    processingPipelineLoan: { findMany: m.rows, findUnique: m.row, update: m.forbiddenWrite, updateMany: m.forbiddenWrite },
    arivePracticeLoan: { findMany: m.practice },
    auditLog: { findFirst: m.auditFirst, findUnique: m.auditUnique, findMany: m.auditMany, create: m.auditCreate, update: m.auditUpdate, updateMany: m.auditUpdateMany },
    loan: { update: m.forbiddenWrite }, task: { update: m.forbiddenWrite }, notification: { create: m.forbiddenWrite },
  }));
  m.forbiddenWrite.mockRejectedValue(new Error('Production workflow mutation attempted'));
  m.chunk.mockImplementation(async (input: AriveActiveDiagnosticChunkInput) => { await input.guard(); const result = completed(input); await input.guard(); return result; });
});
afterEach(() => {
  expect(m.forbiddenWrite).not.toHaveBeenCalled();
  for (const [call] of m.auditCreate.mock.calls) expect(call.data.action).toBe(ACTION);
  for (const [call] of m.auditUpdate.mock.calls) expect(Object.keys(call.data)).toEqual(['details']);
  vi.useRealTimers(); vi.unstubAllEnvs();
});

describe('active pipeline diagnostic authorization and isolation', () => {
  it.each(['signed out', 'inactive', 'revoked admin', 'lower admin', 'wrong active role', 'preview'])('blocks %s for every interface before records or requests', async scenario => {
    if (scenario === 'signed out') m.session.mockResolvedValue(null);
    if (scenario === 'inactive') state.actor.active = false;
    if (scenario === 'revoked admin') state.actor.role = 'LOAN_OFFICER';
    if (scenario === 'lower admin') state.session.user.role = 'ADMIN_II';
    if (scenario === 'wrong active role') state.session.user.activeRole = 'LOAN_OFFICER';
    if (scenario === 'preview') vi.stubEnv('VERCEL_ENV', 'preview');
    expect((await startActivePipelineDiagnostic()).success).toBe(false);
    expect((await startActivePipelineDiagnosticFollowUp({ runId: 'run-1' })).success).toBe(false);
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
    expect((await continueActivePipelineDiagnostic({ runId: 'run-1' })).success).toBe(false);
    expect((await cancelActivePipelineDiagnostic({ runId: 'run-1' })).success).toBe(false);
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.auditFirst).not.toHaveBeenCalled();
    expect(m.rows).not.toHaveBeenCalled(); expect(m.chunk).not.toHaveBeenCalled();
  });
  it.each(['collectionEnabled', 'applicationEnabled', 'enrollmentEnabled'] as const)('requires %s to remain off', async field => {
    state.control[field] = true;
    expect((await startActivePipelineDiagnostic()).success).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled(); expect(m.chunk).not.toHaveBeenCalled();
  });
  it('also refuses enabled workers or active sync leases while global controls are off', async () => {
    state.running = 1;
    expect((await startActivePipelineDiagnostic()).success).toBe(false);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('requires shared request readiness but does not require enabling rollout collection', async () => {
    m.budget.mockResolvedValueOnce({ ready: false, reason: 'Shared request controls are unavailable' });
    expect(await startActivePipelineDiagnostic()).toMatchObject({ success: false, error: 'Shared request controls are unavailable' });
    expect(m.auditCreate).not.toHaveBeenCalled();
    expect((await startActivePipelineDiagnostic()).success).toBe(true);
    expect(m.budget).toHaveBeenCalledWith({ allowCooldown: true });
    expect(state.control).toMatchObject({ collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false });
  });
  it('captures only active Pipeline membership and persists no borrower text or connection contents', async () => {
    const archived = source(2); archived.archivedAt = NOW;
    const funding = source(3); funding.sheet = 'FUNDING';
    const restructure = source(4); restructure.sheet = 'RESTRUCTURE';
    state.sources.push(archived, funding, restructure);
    const run = await start();
    expect(run).toMatchObject({ total: 1, checked: 0, status: 'READY', automaticSyncPaused: true });
    expect(run.rows[0]).toMatchObject({ borrowerName: 'Synthetic Person 1', outcome: 'PENDING' });
    expect(latest()?.details).not.toContain('Synthetic Person');
    expect(latest()?.details).not.toContain('officer@example.test');
    expect(latest()?.details).not.toContain(state.config.encryptedCredentials);
    expect(JSON.stringify(run)).not.toMatch(/credentialHash|credentialRevision|leaseToken|sourceHash|encrypted-private/);
    expect(m.chunk).not.toHaveBeenCalled();
    expect(m.auditCreate.mock.calls[0][0].data.loanId).toBeUndefined();
    expect(m.lock).toHaveBeenCalled();
  });
  it('opening saved progress is database-only and adding loans never changes the fixed cohort', async () => {
    const run = await start(); state.sources.push(source(2));
    const loaded = await getActivePipelineDiagnostic();
    expect(loaded).toMatchObject({ success: true, run: { id: run.id, total: 1, currentActiveCount: 2, addedSinceStart: 1 } });
    expect(m.chunk).not.toHaveBeenCalled();
    expect(persisted().cohort).toHaveLength(1);
  });
  it('repeated Start returns the same unfinished run without replacing progress', async () => {
    const first = await start(); const second = await start();
    expect(second.id).toBe(first.id); expect(m.auditCreate).toHaveBeenCalledOnce();
  });
  it('rejects a cohort above the cap without starting a truncated run', async () => {
    state.sources = Array.from({ length: 1001 }, (_, index) => source(index + 1));
    expect(await startActivePipelineDiagnostic()).toMatchObject({ success: false, error: expect.stringContaining('1,000-file') });
    expect(m.auditCreate).not.toHaveBeenCalled(); expect(m.chunk).not.toHaveBeenCalled();
  });
  it('completes an empty active pipeline without requests', async () => {
    state.sources = [];
    expect(await startActivePipelineDiagnostic()).toMatchObject({ success: true, run: { status: 'COMPLETE', total: 0, checked: 0 } });
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it('rejects arbitrary audit rows and invalid run IDs', async () => {
    audits.push({ id: 'unrelated-audit', action: 'PROCESSING_ARIVE_SYNC_APPLIED', details: '{}', userId: 'admin', createdAt: NOW });
    expect((await continueActivePipelineDiagnostic({ runId: 'unrelated-audit' })).success).toBe(false);
    expect((await cancelActivePipelineDiagnostic({ runId: '../invalid' })).success).toBe(false);
    expect(m.chunk).not.toHaveBeenCalled(); expect(m.auditUpdate).not.toHaveBeenCalled();
  });
});

describe('diagnostic chunks, leases, and interrupted work', () => {
  it('records successful strict checks only in its diagnostic audit row', async () => {
    const run = await start();
    const result = await continueActivePipelineDiagnostic({ runId: run.id });
    expect(result).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 1, matched: 1, getRequests: 2, authenticationRequests: 0 } });
    expect(m.chunk.mock.calls[0][0].loans[0]).toMatchObject({ pipelineId: 'pipeline-1', savedGuid: 'guid-1', savedOriginatorEmail: 'officer@example.test' });
    expect(persisted()).toMatchObject({ cursor: 1, leaseToken: null, reservedGets: 2, reservedAuth: 0 });
    expect(state.sources[0]).toEqual(source());
  });
  it('returns existing progress on an active lease and prevents double execution', async () => {
    const run = await start(); let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => { entered(); await waiting; await input.guard(); return completed(input); });
    const first = continueActivePipelineDiagnostic({ runId: run.id }); await enteredPromise;
    const second = await continueActivePipelineDiagnostic({ runId: run.id });
    expect(second).toMatchObject({ success: true, run: { status: 'RUNNING', checked: 0 } });
    expect(m.chunk).toHaveBeenCalledOnce();
    release(); expect(await first).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 1 } });
  });
  it('preserves the consumed prefix and retry time when a shared budget defers a chunk', async () => {
    state.sources = [source(1), source(2), source(3)]; const run = await start();
    const retryAt = new Date(NOW.getTime() + 60_000).toISOString();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => ({ ...completed({ ...input, loans: input.loans.slice(0, 1) }),
      deferred: { code: 'BUDGET_EXHAUSTED', retryAt, phase: 'SEARCH', httpStatus: null, gatewayCode: null } }));
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'DEFERRED', checked: 1, matched: 1, retryAt } });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { checked: 1 } });
    expect(m.chunk).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(NOW.getTime() + 60_001));
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 3 } });
    expect(m.chunk.mock.calls[1][0].loans.map((loan: { pipelineId: string }) => loan.pipelineId)).toEqual(['pipeline-2', 'pipeline-3']);
  });
  it('keeps lost-lease reservations charged when an interrupted chunk is resumed', async () => {
    const run = await start();
    rewrite(value => { value.status = 'RUNNING'; value.leaseToken = 'expired-lease'; value.leaseUntil = new Date(NOW.getTime() - 1).toISOString(); value.leaseActorId = 'admin'; value.reservedGets = 16; value.reservedAuth = 2; });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 1 } });
    expect(persisted()).toMatchObject({ reservedGets: 18, reservedAuth: 2, getRequests: 2 });
  });
  it('stops before provider work when prior reservations exhausted the run allowance', async () => {
    const run = await start(); rewrite(value => { value.reservedGets = 32; });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'INVALIDATED', checked: 0 } });
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it('cancellation fences a late response without overwriting cancelled state', async () => {
    const run = await start();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      expect(await cancelActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'CANCELLED' } });
      return completed(input);
    });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'CANCELLED', checked: 0, matched: 0 } });
    expect(persisted()).toMatchObject({ cursor: 0, leaseToken: null, reservedGets: 16, reservedAuth: 2 });
  });
  it('never replays a completed run', async () => {
    const run = await start(); await continueActivePipelineDiagnostic({ runId: run.id });
    await continueActivePipelineDiagnostic({ runId: run.id });
    expect(m.chunk).toHaveBeenCalledOnce();
  });
  it('does not accept a response after its execution lease expires', async () => {
    const run = await start();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      vi.setSystemTime(new Date(NOW.getTime() + 180_001)); return completed(input);
    });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'INVALIDATED', checked: 0, matched: 0 } });
    expect(persisted()).toMatchObject({ reservedGets: 16, reservedAuth: 2, leaseToken: null, leaseActorId: null });
  });
  it('projects an expired lease as resumable without clearing its reserved allowance', async () => {
    const run = await start();
    rewrite(value => { value.status = 'RUNNING'; value.leaseToken = 'expired-lease'; value.leaseUntil = new Date(NOW.getTime() - 1).toISOString(); value.leaseActorId = 'admin'; value.reservedGets = 16; value.reservedAuth = 2; });
    expect(await getActivePipelineDiagnostic()).toMatchObject({ success: true, run: { id: run.id, status: 'READY', checked: 0 } });
    expect(persisted()).toMatchObject({ status: 'RUNNING', reservedGets: 16, reservedAuth: 2 });
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it('throttles new runs without preventing continuation of existing progress', async () => {
    const run = await start(); await continueActivePipelineDiagnostic({ runId: run.id });
    expect(await startActivePipelineDiagnostic()).toMatchObject({ success: false, error: expect.stringContaining('five minutes') });
    expect(m.auditCreate).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1));
    const next = await start(); expect(next.id).not.toBe(run.id);
    expect(await continueActivePipelineDiagnostic({ runId: next.id })).toMatchObject({ success: true, run: { status: 'COMPLETE' } });
  });
  it('redacts unexpected errors and conservatively retains the chunk reservation', async () => {
    const run = await start(); m.chunk.mockRejectedValueOnce(new Error('private-provider-body secret-token'));
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toEqual({ success: false, error: 'The read-only diagnostic could not finish. Saved progress is retained.' });
    expect(persisted()).toMatchObject({ status: 'INVALIDATED', cursor: 0, leaseToken: null, reservedGets: 16, reservedAuth: 2 });
    expect(latest()?.details).not.toContain('secret-token');
  });
});

describe('changes during a fixed-cohort check', () => {
  it.each(['control generation', 'credential timestamp', 'credential ciphertext', 'sync worker enabled'])('blocks continuation after %s changes', async scenario => {
    const run = await start();
    if (scenario === 'control generation') state.control.generation++;
    if (scenario === 'credential timestamp') state.config.updatedAt = new Date(NOW);
    if (scenario === 'credential ciphertext') state.config.encryptedCredentials = 'rotated-private-connection';
    if (scenario === 'sync worker enabled') state.running = 1;
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false);
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it('rejects a connection rotation inside a chunk before accepting its response', async () => {
    const run = await start();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      state.config.encryptedCredentials = 'rotated-private-connection'; await input.guard(); return completed(input);
    });
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false);
    expect(persisted()).toMatchObject({ status: 'INVALIDATED', cursor: 0 });
  });
  it.each(['credentials', 'controls'])('discards a late chunk after %s change while retaining earlier verified progress and request charges', async changed => {
    state.sources = Array.from({ length: 6 }, (_, index) => source(index + 1));
    const run = await start();
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'READY', checked: 5, matched: 5, getRequests: 10 } });
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      if (changed === 'credentials') state.config.encryptedCredentials = 'rotated-after-provider-response'; else state.control.generation++;
      return completed(input);
    });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'INVALIDATED', checked: 5, matched: 5, getRequests: 12 } });
    expect(persisted()).toMatchObject({ cursor: 5, reservedGets: 12, reservedAuth: 0, leaseToken: null });
    expect(persisted().results.map((row: { pipelineId: string }) => row.pipelineId)).toEqual(['pipeline-1', 'pipeline-2', 'pipeline-3', 'pipeline-4', 'pipeline-5']);
  });
  it.each(['revoked role', 'different account'])('rejects %s during remote work and does not expose borrower results', async scenario => {
    const run = await start();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      if (scenario === 'revoked role') state.actor.role = 'LOAN_OFFICER'; else state.session.user.id = 'other-admin';
      await input.guard(); return completed(input);
    });
    const result = await continueActivePipelineDiagnostic({ runId: run.id });
    expect(result.success).toBe(false); expect(JSON.stringify(result)).not.toContain('Synthetic Person');
    expect(persisted()).toMatchObject({ status: 'INVALIDATED', cursor: 0 });
  });
  it('records source changes without sending the changed identity to Arive', async () => {
    const run = await start(); state.sources[0].version++;
    const result = await continueActivePipelineDiagnostic({ runId: run.id });
    expect(result).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 1, matched: 0, changedSinceStart: 1 } });
    expect(m.chunk.mock.calls[0][0].loans).toEqual([]);
    expect(persisted().results[0].outcome).toBe('SOURCE_CHANGED');
  });
  it('does not accept a successful response for an identity changed while the read was in flight', async () => {
    const run = await start();
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => { state.sources[0].loan.borrowerLastName = 'Changed'; return completed(input); });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { checked: 1, matched: 0, changedSinceStart: 1, rows: [expect.objectContaining({ outcome: 'SOURCE_CHANGED' })] } });
  });
  it('preserves fixed order around changed records when the next unchanged file is deferred', async () => {
    state.sources = [source(1), source(2), source(3), source(4)]; const run = await start();
    state.sources[0].version++; state.sources[2].version++;
    m.chunk.mockResolvedValueOnce({ results: [], consumed: 0, getRequests: 0, authenticationRequests: 0, invalidated: false,
      deferred: { code: 'BUSY', retryAt: new Date(NOW.getTime() + 5000).toISOString(), phase: 'SEARCH', httpStatus: null, gatewayCode: null } });
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'DEFERRED', checked: 1, matched: 0 } });
    expect(persisted().results.map((row: { pipelineId: string }) => row.pipelineId)).toEqual(['pipeline-1']);
    vi.setSystemTime(new Date(NOW.getTime() + 5001));
    expect(await continueActivePipelineDiagnostic({ runId: run.id })).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 4, matched: 2 } });
    expect(persisted().results.map((row: { pipelineId: string }) => row.pipelineId)).toEqual(['pipeline-1', 'pipeline-2', 'pipeline-3', 'pipeline-4']);
  });
  it('marks a previously matched file changed when its current identity no longer matches the frozen cohort', async () => {
    const run = await start(); await continueActivePipelineDiagnostic({ runId: run.id }); state.sources[0].loan.loanOfficer.email = 'new-officer@example.test';
    expect(await getActivePipelineDiagnostic()).toMatchObject({ success: true, run: { checked: 1, matched: 0, needsReview: 1, changedSinceStart: 1 } });
  });
  it('expires old runs before another request can start', async () => {
    const run = await start(); vi.setSystemTime(new Date(NOW.getTime() + 6 * 60 * 60_000 + 1));
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false); expect(m.chunk).not.toHaveBeenCalled();
  });
});

describe('durable state validation', () => {
  it.each(['invalid json', 'wrong schema', 'cursor mismatch'])('rejects %s without provider work', async scenario => {
    const run = await start();
    if (scenario === 'invalid json') latest()!.details = '{invalid';
    if (scenario === 'wrong schema') rewrite(value => { value.schema = 99; });
    if (scenario === 'cursor mismatch') rewrite(value => { value.cursor = 1; });
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false);
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it.each(['negative request count', 'missing reservation', 'invalid status', 'invalid start date', 'invalid credential date',
    'invalid retry date', 'invalid lease date', 'negative generation', 'invalid source hash', 'duplicate cohort', 'complete without outcomes'])('rejects %s before resuming', async scenario => {
    const run = await start();
    rewrite(value => {
      if (scenario === 'negative request count') value.getRequests = -1;
      if (scenario === 'missing reservation') delete value.reservedAuth;
      if (scenario === 'invalid status') value.status = 'UNTRUSTED';
      if (scenario === 'invalid start date') value.startedAt = 'not-a-date';
      if (scenario === 'invalid credential date') value.credentialRevision = 'not-a-date';
      if (scenario === 'invalid retry date') value.retryAt = 'not-a-date';
      if (scenario === 'invalid lease date') value.leaseUntil = 'not-a-date';
      if (scenario === 'negative generation') value.generation = -1;
      if (scenario === 'invalid source hash') value.cohort[0].sourceHash = 'invalid';
      if (scenario === 'duplicate cohort') value.cohort.push({ ...value.cohort[0] });
      if (scenario === 'complete without outcomes') value.status = 'COMPLETE';
    });
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false);
    expect(m.chunk).not.toHaveBeenCalled();
  });
  it('rejects results whose IDs are not the fixed cohort prefix', async () => {
    state.sources = [source(1), source(2)]; const run = await start();
    await continueActivePipelineDiagnostic({ runId: run.id }); m.chunk.mockClear();
    rewrite(value => { value.results.reverse(); });
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
    expect((await continueActivePipelineDiagnostic({ runId: run.id })).success).toBe(false);
    expect(m.chunk).not.toHaveBeenCalled();
  });
});

describe('targeted follow-up diagnostics', () => {
  const advance = () => vi.setSystemTime(new Date(Date.now() + 5 * 60_000 + 1));
  async function completeFull(indices = [1, 2, 3]) {
    state.sources = indices.map(index => source(index));
    const run = await start(); await continueActivePipelineDiagnostic({ runId: run.id }); return run;
  }
  async function followUp(runId: string) {
    const result = await startActivePipelineDiagnosticFollowUp({ runId });
    if (!result.success || !result.run) throw new Error(JSON.stringify(result));
    return result.run;
  }

  it('captures only review outcomes, changed identities and new active files without editing the parent run', async () => {
    const parent = await completeFull();
    rewrite(value => { value.results[1].outcome = 'IDENTITY_MISMATCH'; });
    const original = latest()!.details;
    state.sources[2].version++; state.sources.push(source(4)); advance();
    const run = await followUp(parent.id);
    expect(run).toMatchObject({ scope: 'FOLLOW_UP', parentRunId: parent.id, rootRunId: parent.id, total: 3, checked: 0, baselineTotal: 4, currentActiveCount: 4, addedSinceStart: 0 });
    expect(run.rows.map(row => row.pipelineId)).toEqual(['pipeline-2', 'pipeline-3', 'pipeline-4']);
    expect(audits.find(row => row.id === parent.id)!.details).toBe(original);
    expect(persisted().lineage.carriedMatchedPipelineIds).toEqual(['pipeline-1']);
    m.chunk.mockClear();
    await continueActivePipelineDiagnostic({ runId: run.id });
    expect(m.chunk.mock.calls[0][0]).toMatchObject({ investigate: true });
    expect(m.chunk.mock.calls[0][0].loans.map((row: { pipelineId: string }) => row.pipelineId)).toEqual(['pipeline-2', 'pipeline-3', 'pipeline-4']);
  });

  it('keeps lineage membership on repeated follow-ups and never counts carried matches as newly added loans', async () => {
    const parent = await completeFull([1, 2]);
    rewrite(value => { value.results[1].outcome = 'NO_API_MATCH'; });
    state.sources.push(source(3)); advance();
    const first = await followUp(parent.id); await continueActivePipelineDiagnostic({ runId: first.id });
    state.sources[0].version++; state.sources.push(source(4)); advance();
    const second = await followUp(first.id);
    expect(second).toMatchObject({ rootRunId: parent.id, parentRunId: first.id, total: 2, baselineTotal: 4, addedSinceStart: 0 });
    expect(second.rows.map(row => row.pipelineId)).toEqual(['pipeline-1', 'pipeline-4']);
    expect(persisted().lineage.carriedMatchedPipelineIds.sort()).toEqual(['pipeline-2', 'pipeline-3']);
    state.sources.push(source(5));
    expect(await getActivePipelineDiagnostic()).toMatchObject({ success: true, run: { total: 2, currentActiveCount: 5, addedSinceStart: 1 } });
  });

  it('returns an already-started child when a repeated follow-up request arrives', async () => {
    const parent = await completeFull([1]); rewrite(value => { value.results[0].outcome = 'NO_API_MATCH'; }); advance();
    const child = await followUp(parent.id);
    expect((await followUp(parent.id)).id).toBe(child.id);
    expect(m.auditCreate).toHaveBeenCalledTimes(2);
  });

  it('records prior review items that left the pipeline without making Arive requests for them', async () => {
    const parent = await completeFull([1, 2]); rewrite(value => { value.results.forEach((row: { outcome: string }) => { row.outcome = 'NO_API_MATCH'; }); });
    state.sources[0].sheet = 'FUNDING'; state.sources.splice(1, 1); advance();
    const child = await followUp(parent.id);
    expect(child).toMatchObject({ total: 2, currentActiveCount: 0, baselineTotal: 2, addedSinceStart: 0 });
    m.chunk.mockClear();
    const result = await continueActivePipelineDiagnostic({ runId: child.id });
    expect(result).toMatchObject({ success: true, run: { status: 'COMPLETE', checked: 2, matched: 0 } });
    expect(m.chunk.mock.calls[0][0].loans).toEqual([]);
    expect(persisted().results.every((row: { outcome: string; message: string }) => row.outcome === 'SOURCE_CHANGED' && row.message.includes('no longer in the active pipeline'))).toBe(true);
  });

  it('completes an empty follow-up with no provider work and still retains the original baseline', async () => {
    const parent = await completeFull([1, 2]); advance(); m.chunk.mockClear();
    expect(await startActivePipelineDiagnosticFollowUp({ runId: parent.id })).toMatchObject({ success: true, run: { status: 'COMPLETE', total: 0, baselineTotal: 2, currentActiveCount: 2, addedSinceStart: 0 } });
    expect(m.chunk).not.toHaveBeenCalled();
  });

  it('rejects a nonterminal, unknown, malformed or superseded parent', async () => {
    const parent = await start(); advance();
    expect((await startActivePipelineDiagnosticFollowUp({ runId: parent.id })).success).toBe(false);
    await continueActivePipelineDiagnostic({ runId: parent.id });
    expect((await startActivePipelineDiagnosticFollowUp({ runId: 'unknown-run' })).success).toBe(false);
    expect((await startActivePipelineDiagnosticFollowUp({ runId: '../not-a-run' })).success).toBe(false);
    await start(); advance();
    expect((await startActivePipelineDiagnosticFollowUp({ runId: parent.id })).success).toBe(false);
    expect(m.auditCreate).toHaveBeenCalledTimes(2);
  });

  it.each(['credential timestamp', 'credential ciphertext', 'generation', 'collection', 'application', 'enrollment', 'active worker'])('does not carry matches forward after %s changes', async scenario => {
    const parent = await completeFull([1]); advance();
    if (scenario === 'credential timestamp') state.config.updatedAt = new Date();
    if (scenario === 'credential ciphertext') state.config.encryptedCredentials = 'changed-secret';
    if (scenario === 'generation') state.control.generation++;
    if (scenario === 'collection') state.control.collectionEnabled = true;
    if (scenario === 'application') state.control.applicationEnabled = true;
    if (scenario === 'enrollment') state.control.enrollmentEnabled = true;
    if (scenario === 'active worker') state.running = 1;
    m.chunk.mockClear();
    expect((await startActivePipelineDiagnosticFollowUp({ runId: parent.id })).success).toBe(false);
    expect(m.auditCreate).toHaveBeenCalledOnce(); expect(m.chunk).not.toHaveBeenCalled();
  });

  it('can follow up old completed evidence while applying a fresh expiry to the new run', async () => {
    const parent = await completeFull([1]); rewrite(value => { value.results[0].outcome = 'NO_API_MATCH'; });
    vi.setSystemTime(new Date(Date.now() + 7 * 60 * 60_000));
    const child = await followUp(parent.id);
    expect(child.startedAt).toBe(new Date().toISOString()); expect(child.total).toBe(1);
  });

  it('persists only bounded identity evidence and rejects oversized evidence before saving results', async () => {
    const parent = await completeFull([1]); rewrite(value => { value.results[0].outcome = 'IDENTITY_MISMATCH'; }); advance();
    const child = await followUp(parent.id);
    m.chunk.mockImplementationOnce(async (input: AriveActiveDiagnosticChunkInput) => {
      const result = completed(input);
      Object.assign(result.results[0], { requestId: 'safe-request-id', evidence: {
        portal: { loanNumber: '99000001', savedGuid: 'guid-1', primaryOriginatorEmail: 'officer@example.test', secondaryOriginatorEmail: null, savedOriginatorEmail: 'officer@example.test', borrowerName: 'Synthetic Person 1', unrelated: 'secret-unrelated' },
        detail: { loanNumber: '99000001', guid: 'guid-1', originatorEmail: 'other@example.test', borrowers: ['Synthetic Person 1'], issues: ['ORIGINATOR'], team: [{ email: 'officer@example.test', role: 'LoanOfficer', primary: false }], otherApplicants: [{ name: 'Synthetic Coapplicant', applicantType: 'CoBorrower' }], secret: 'never-persist' },
        rawBody: 'never-persist',
      } }); return result;
    });
    const response = await continueActivePipelineDiagnostic({ runId: child.id });
    expect(response).toMatchObject({ success: true, run: { rows: [{ requestId: 'safe-request-id', evidence: { detail: { originatorEmail: 'other@example.test' } } }] } });
    expect(latest()!.details).not.toMatch(/secret-unrelated|never-persist|rawBody/);
    rewrite(value => { value.results[0].evidence.detail.borrowers = Array(11).fill('Borrower'); });
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
  });

  it('rejects corrupt lineage instead of turning carried rows into arbitrary matches', async () => {
    const parent = await completeFull([1, 2]); rewrite(value => { value.results[1].outcome = 'NO_API_MATCH'; }); advance();
    const child = await followUp(parent.id);
    rewrite(value => { value.lineage.carriedMatchedPipelineIds.push('not-in-baseline'); });
    expect((await getActivePipelineDiagnostic()).success).toBe(false);
    expect((await continueActivePipelineDiagnostic({ runId: child.id })).success).toBe(false);
  });
});
