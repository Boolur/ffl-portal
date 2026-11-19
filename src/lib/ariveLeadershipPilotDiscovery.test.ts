import { describe, expect, it, vi } from 'vitest';
import { runLeadershipPilotCollection } from './ariveLeadershipPilotWorker';

vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({ prisma: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));

describe('private Pilot discovery', () => {
  it('resumes across runs while provider collection is at capacity', async () => {
    const loans = Array.from({ length: 103 }, (_, i) => ({
      id: `pipeline-${i}`, loanId: `loan-${i}`, loan: { loanNumber: String(i + 1) }, ariveSync: null,
    }));
    const seeded = new Set<string>();
    const candidates = vi.fn(async ({ take }: { take: number }) => loans.filter(row => !seeded.has(row.id)).slice(0, take));
    const control = { enabled: true, generation: 1, cohortLimit: 10, lastHintScanAt: new Date() };
    const tx = {
      $executeRaw: vi.fn(), $queryRaw: vi.fn(async () => []),
      processingPipelineLoan: { findMany: candidates },
      ariveIntegrationConfig: { findUnique: vi.fn(async () => null) },
      pilotAriveControl: { findUnique: vi.fn(async () => control), update: vi.fn() },
      pilotAriveProjection: {
        count: vi.fn(async () => 2),
        createMany: vi.fn(async ({ data }: { data: { pipelineId: string }[] }) => {
          for (const row of data) seeded.add(row.pipelineId);
        }),
      },
    };
    const db = { $queryRaw: tx.$queryRaw, $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
    const session = vi.fn();
    const options = { db: db as never, session };
    await runLeadershipPilotCollection(options);
    expect(seeded.size).toBe(100);
    await runLeadershipPilotCollection(options);
    await runLeadershipPilotCollection(options);
    expect(seeded.size).toBe(103);
    expect(tx.pilotAriveProjection.createMany).toHaveBeenCalledTimes(2);
    expect(candidates).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ pilotArive: null }) }));
    expect(session).not.toHaveBeenCalled();
  });
});
