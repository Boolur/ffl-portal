import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
import { collectPilotChangeHints, parsePilotChangeHints } from './ariveLeadershipPilotHints';

const start = new Date('2026-04-15T12:00:00Z');
const modified = new Date(+start - 60_000);
const row = { ariveLoanId: '801', sysGUID: 'synthetic-guid', modifiedDateTime: modified.toISOString(),
  currentLoanStatus: { status: 'Docs out' } };

function setup(limit: number | null = null) {
  const control = { enabled: true, cohortLimit: limit, generation: 1, lastHintScanAt: null as Date | null };
  const connection = { updatedAt: new Date(+start - 86_400_000) };
  const file = { pipelineId: 'synthetic-file', ariveLoanId: row.ariveLoanId, ariveGuid: row.sysGUID,
    sourceModifiedAt: modified, sourceStage: 'UNDERWRITING_SUBMITTED', lastAttemptAt: start,
    lastHintModifiedAt: null as Date | null, hintRequestedAt: null as Date | null };
  let queued = 0;
  const tx = {
    $executeRaw: vi.fn(async (parts: TemplateStringsArray) => { if (parts.join('?').includes('UPDATE "PilotAriveProjection"')) queued++; }),
    pilotAriveControl: { findUnique: vi.fn(async () => ({ ...control })), update: vi.fn(async ({ data }) => Object.assign(control, data)) },
    ariveIntegrationConfig: { findUnique: vi.fn(async () => ({ ...connection })) },
    pilotAriveProjection: { findFirst: vi.fn(async () => ({ pipelineId: file.pipelineId })), findMany: vi.fn(async () => [{ ...file }]) },
  };
  // The shared advisory transaction lock serializes separate cron invocations.
  let prior = Promise.resolve();
  const db = { $transaction: (callback: (locked: typeof tx) => Promise<unknown>) => {
    const result = prior.then(() => callback(tx));
    prior = result.then(() => {}, () => {});
    return result;
  } };
  const api = vi.fn(async () => ({ count: 1, rows: [row] }));
  const scan = (at: Date) => collectPilotChangeHints(db as never, at, async () => api as never);
  return { control, connection, file, tx, api, scan, queued: () => queued };
}

describe('modified-loan hints', () => {
  it('rejects conflicting stage signals for the same identity and source time', () => {
    expect(parsePilotChangeHints({ count: 2, rows: [row, { ...row, currentLoanStatus: { status: 'SUSPENDED' } }] })).toEqual([]);
    expect(parsePilotChangeHints({ count: 1, rows: [row] })[0].stage).toBe('DOCS_OUT');
  });

  it.each([{ limit: null, interval: 20_000 }, { limit: 50, interval: 60_000 }])(
    'limits concurrent listing scans across instances to once every $interval ms', async ({ limit, interval }) => {
      const h = setup(limit);
      await Promise.all([h.scan(start), h.scan(start), h.scan(new Date(+start + interval - 1))]);
      expect(h.api).toHaveBeenCalledTimes(1);
      await h.scan(new Date(+start + interval));
      expect(h.api).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['stage changed', 'small cohort', 'same stage', 'older list', 'older than hint', 'wrong GUID',
    'already queued', 'recently rechecked', 'persistent mismatch', 'newer source'])(
    'queues a complete read only for valid eligible signals (%s)', async scenario => {
      const h = setup(scenario === 'small cohort' ? 10 : null);
      if (scenario === 'same stage') h.file.sourceStage = 'docs-out';
      if (scenario === 'older list') h.file.sourceModifiedAt = new Date(+modified + 1);
      if (scenario === 'older than hint') h.file.lastHintModifiedAt = new Date(+modified + 1);
      if (scenario === 'wrong GUID') h.file.ariveGuid = 'another-guid';
      if (['already queued', 'recently rechecked', 'persistent mismatch'].includes(scenario)) {
        h.file.lastHintModifiedAt = modified;
        if (scenario !== 'recently rechecked') h.file.lastAttemptAt = new Date(+start - 5 * 60_000);
        if (scenario === 'already queued') h.file.hintRequestedAt = start;
      }
      if (scenario === 'newer source') h.file.sourceModifiedAt = new Date(+modified - 1);
      await h.scan(start);
      expect(h.queued()).toBe(['stage changed', 'persistent mismatch', 'newer source'].includes(scenario) ? 1 : 0);
      expect(h.tx.pilotAriveProjection.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { enrollmentStatus: 'VERIFIED', connectionRevision: h.connection.updatedAt, failureCount: 0, ariveLoanId: { in: ['801'] } },
      }));
    },
  );
  it.each(['paused', 'generation changed', 'credentials rotated', 'newer scan claimed'])(
    'discards an in-flight list if %s', async scenario => {
      const h = setup();
      h.api.mockImplementationOnce(async () => {
        if (scenario === 'paused') h.control.enabled = false;
        if (scenario === 'generation changed') h.control.generation++;
        if (scenario === 'credentials rotated') h.connection.updatedAt = start;
        if (scenario === 'newer scan claimed') h.control.lastHintScanAt = new Date(+start + 20_000);
        return { count: 1, rows: [row] };
      });
      await h.scan(start);
      expect(h.queued()).toBe(0);
      expect(h.tx.pilotAriveProjection.findMany).not.toHaveBeenCalled();
    },
  );
});
