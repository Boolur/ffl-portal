import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { requestPilotFileRefresh } from './ariveLeadershipPilotWorker';
import { pilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { pilotReviewMessage, summarizePilotCoverage } from './leadershipPilotReads';
import { isPilotAccessDenied } from './ariveSyncTypes';

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
  it('does not count a legacy ambiguous numeric probe as a confirmed file access denial', () => {
    const legacy = 'Previous branch check returned HTTP 403. Arive denied access to this file.';
    expect(isPilotAccessDenied(pilotReviewMessage(legacy))).toBe(false);
    expect(isPilotAccessDenied(pilotReviewMessage('Arive denied the branch detail request for the matched loan ID (HTTP 403).'))).toBe(true);
    expect(pilotReviewMessage(null)).toBeNull();
  });
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

  it('expedites an explicit retry only after the source identity or branch connection changed since the failed check', async () => {
    const failedAt = new Date(+now - 120_000), correctedAt = new Date(+now - 60_000), retry = new Date(+now + 3_600_000);
    for (const [cause, watch, expected] of [
      ['number', false, true], ['credentials', false, true], ['same identity', false, false],
      ['already tried', false, false], ['number', true, false],
    ] as const) {
      const db = {
        $executeRaw: vi.fn(),
        pilotAriveControl: { findUnique: vi.fn().mockResolvedValue({enabled: true, cohortLimit: null}) },
        ariveIntegrationConfig: { findUnique: vi.fn().mockResolvedValue({ updatedAt: cause === 'credentials' ? correctedAt : failedAt }) },
        processingPipelineLoan: { findUnique: vi.fn().mockResolvedValue({
          loan: { ...loan, updatedAt: cause === 'already tried' ? new Date(+failedAt - 1000) : correctedAt },
          pilotArive: { enrollmentStatus: 'REVIEW', ariveLoanId: ['number','already tried'].includes(cause) ? 'old-number' : loan.loanNumber,
            identityHash: pilotIdentityHash(loan), connectionRevision: failedAt, lastAttemptAt: failedAt, nextAttemptAt: retry,
            failureCount: 1, manualRefreshRequestedAt: null, leaseToken: null, leaseUntil: null },
        }) },
        pilotAriveProjection: { upsert: vi.fn() },
      };
      expect(await requestPilotFileRefresh('fixture', {watch},
        { $transaction: (work: (client: typeof db) => unknown) => work(db) } as never)).toEqual({ queued: true });
      const patch = db.pilotAriveProjection.upsert.mock.calls[0][0].update;
      if (expected) expect(patch.nextAttemptAt).toEqual(patch.manualRefreshRequestedAt);
      else expect(patch).not.toHaveProperty('nextAttemptAt');
    }
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
    const files = [...all.map(file => ({ id: file.pipelineId, sheet: file.pipelineId === 'late-active' ? 'RESTRUCTURE' : 'PIPELINE',
      archivedAt: file.pipelineId === 'archived' ? now : null, loan })), { id: 'new', sheet: 'PIPELINE', loan }];
    expect(summarizePilotCoverage(files, new Map(all.map(file => [file.pipelineId, file])), now))
      .toEqual({ eligible: 10, verified: 4, pending: 1, waiting: 1, inaccessible: 1, review: 3,
        excluded: 1, verifiedActive: 2, activeFresh: 1, verifiedQuiet: 2, quietFresh: 1, oldestDueSeconds: 10,
        sourcePipeline: { total: 9, verified: 2, pending: 2, review: 4, excluded: 1 } });
  });
});
