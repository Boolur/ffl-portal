import { createHash } from 'node:crypto';
import { prisma } from './prisma';
import type { PortalTopic } from './portalLiveUpdates';

type Snapshot = Record<PortalTopic, string>;
let cached: { value: Snapshot; expires: number } | undefined;
let pending: Promise<Snapshot> | undefined;

/** Only three tiny markers, never task/loan histories or customer information. */
export async function getPortalRevisions(): Promise<Snapshot> {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    const rows = await prisma.$queryRaw<Array<{ topic: string; version: bigint }>>`
      SELECT "topic", "version" FROM "PortalRevision"
      WHERE "topic" IN ('overview', 'pipeline', 'tasks')
    `;
    const value = {} as Snapshot;
    for (const topic of ['overview', 'pipeline', 'tasks'] as const) {
      const row = rows.find(row => row.topic === topic);
      if (!row) throw new Error('Portal change markers are not installed.');
      value[topic] = createHash('sha256').update(`${topic}:${row.version}`).digest('hex');
    }
    cached = { value, expires: Date.now() + 1_000 };
    return value;
  })().finally(() => { pending = undefined; });
  return pending;
}
