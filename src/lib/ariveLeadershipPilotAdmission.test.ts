import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { requestPilotFileRefresh } from './ariveLeadershipPilotWorker';
import { pilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { summarizePilotCoverage } from './leadershipPilotReads';

const now = new Date();
const loan = { id: 'fixture', loanNumber: '901', borrowerName: 'Fixture Borrower', borrowerFirstName: 'Fixture',
  borrowerLastName: 'Borrower', loanOfficer: { email: 'fixture@example.test' }, secondaryLoanOfficer: null };
const verified = {
  pipelineId: 'fixture', ariveLoanId: loan.loanNumber, ariveGuid: 'fixture-guid', identityHash: pilotIdentityHash(loan),
  enrollmentStatus: 'VERIFIED', enrollmentIssue: null, reviewConnectionCurrent: true, sourceStage: null, lastError: null, collectedAt: now,
  lastAttemptAt: now, nextAttemptAt: new Date(+now - 10_000), manualRefreshRequestedAt: null, projectionVersion: 1, snapshot: {},
};

function admission(capacity: number, status?: string, reading = false) {
  const tx = {
    $executeRaw: vi.fn(),
    pilotAriveControl: { findUnique: vi.fn().mockResolvedValue({ enabled: true, cohortLimit: 10 }) },
    processingPipelineLoan: { findUnique: vi.fn().mockResolvedValue({ loan, pilotArive: status ? {
      enrollmentStatus: status, manualRefreshRequestedAt: null,
      leaseToken: reading ? 'held' : null, leaseUntil: reading ? new Date(+now + 60_000) : null,
    } : null }) },
    pilotAriveProjection: { count: vi.fn().mockResolvedValue(capacity), upsert: vi.fn() },
  };
  const db = { $transaction: (work: (db: typeof tx) => unknown) => work(tx) };
  return { tx, request: (watch = false) => requestPilotFileRefresh('fixture', { watch }, db as never) };
}

describe('leadership file admission', () => {
  it('does not enqueue a new, pending, or review file outside the cohort on either Sync or watch', async () => {
    for (const status of [undefined, 'PENDING', 'REVIEW']) {
      const { request, tx } = admission(10, status);
      for (const watch of [false, true]) expect(await request(watch)).toEqual({ queued: false, reason: 'COHORT_FULL' });
      expect(tx.pilotAriveProjection.upsert).not.toHaveBeenCalled();
    }
  });

  it('accepts existing members and an available opening, and acknowledges an active read without queuing another', async () => {
    expect(await admission(10, 'VERIFIED').request()).toEqual({ queued: true });
    expect(await admission(9).request()).toEqual({ queued: true });
    const { request, tx } = admission(10, 'PENDING', true);
    expect(await request()).toEqual({ queued: false, reason: 'IN_PROGRESS' });
    expect(tx.pilotAriveProjection.upsert).not.toHaveBeenCalled();
  });

  it('counts each eligible file once, including undiscovered files and failed identities', () => {
    const all = [
      verified, { ...verified, pipelineId: 'denied', enrollmentStatus: 'REVIEW', enrollmentIssue: 'HTTP 403' },
      { ...verified, pipelineId: 'obsolete', enrollmentStatus: 'REVIEW', enrollmentIssue: 'HTTP 403', reviewConnectionCurrent: false },
      { ...verified, pipelineId: 'mismatch', identityHash: null },
      { ...verified, pipelineId: 'missing', enrollmentStatus: 'REVIEW', enrollmentIssue: 'HTTP 404' },
      { ...verified, pipelineId: 'waiting', enrollmentStatus: 'PENDING', pilotRefreshHold: 'COHORT_FULL' as const },
      { ...verified, pipelineId: 'practice', enrollmentStatus: 'EXCLUDED' },
      { ...verified, pipelineId: 'funded', sheet: 'FUNDING', collectedAt: new Date(+now - 30 * 60_000) },
      { ...verified, pipelineId: 'archived', archivedAt: now, collectedAt: new Date(+now - 61 * 60_000) },
      { ...verified, pipelineId: 'late-active', collectedAt: new Date(+now - 61_000) },
    ];
    const files = [...all.map(file => ({ id: file.pipelineId, sheet: 'PIPELINE', loan })), { id: 'new', sheet: 'PIPELINE', loan }];
    expect(summarizePilotCoverage(files, new Map(all.map(file => [file.pipelineId, file])), now))
      .toEqual({ eligible: 10, verified: 4, pending: 1, waiting: 1, inaccessible: 1, review: 3,
        excluded: 1, verifiedActive: 2, activeFresh: 1, verifiedQuiet: 2, quietFresh: 1, oldestDueSeconds: 10 });
  });
});
