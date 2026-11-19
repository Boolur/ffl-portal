import 'server-only';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AriveError } from '@/lib/ariveClient';
import { stableAriveValue } from '@/lib/ariveRollout';

// Only an opaque private record reference and its integrity digest belong in source control.
// Names, addresses and loan identifiers are loaded server-side after action authorization.
const MANIFEST_AUDIT_ID = '785080ef-2c22-49f3-a04f-3814c49be51d';
const MANIFEST_DIGEST = 'ea84a1a504f0f2a215358bbd05527c5adb1708a2faf09a0c8187cfd1f63a75ad';
const MANIFEST_ACTION = 'ARIVE_ONE_TIME_RECONCILIATION_MANIFEST';

export type AriveOneTimeManifestEntry = {
  loanId: string; pipelineId: string; oldNumber: string; ariveLoanId: string;
  borrower: string; sourceName: string; version: number;
  street: string; city: string; state: string; zip: string; tasks: readonly string[];
};

function unavailable(): never { throw new AriveError('The approved private reconciliation list is unavailable or changed. No update was applied.'); }
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const shortText = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);

/** Immutable, digest-bound scope. The caller must authorize before reading this private record. */
export async function getAriveOneTimeManifest(transaction?: Prisma.TransactionClient): Promise<AriveOneTimeManifestEntry[]> {
  const db = transaction || prisma;
  if (transaction) await transaction.$queryRaw`SELECT id FROM "AuditLog" WHERE id = ${MANIFEST_AUDIT_ID} FOR SHARE`;
  const row = await db.auditLog.findUnique({ where: { id: MANIFEST_AUDIT_ID }, select: { action: true, details: true } });
  if (row?.action !== MANIFEST_ACTION || !row.details || row.details.length > 50_000) return unavailable();
  let raw: unknown;
  try { raw = JSON.parse(row.details); } catch { return unavailable(); }
  if (createHash('sha256').update(stableAriveValue(raw)).digest('hex') !== MANIFEST_DIGEST) return unavailable();
  const value = object(raw);
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length !== 7) return unavailable();
  const entries: AriveOneTimeManifestEntry[] = [];
  const loans = new Set<string>(); const pipelines = new Set<string>(); const numbers = new Set<string>(); const taskIds = new Set<string>();
  for (const item of value.entries) {
    const entry = object(item);
    if (!entry || !uuid(entry.loanId) || !uuid(entry.pipelineId) || !shortText(entry.oldNumber)
      || typeof entry.ariveLoanId !== 'string' || !/^\d{1,15}$/.test(entry.ariveLoanId)
      || !['borrower', 'sourceName', 'street', 'city'].every(field => shortText(entry[field]))
      || typeof entry.state !== 'string' || !/^[A-Z]{2}$/.test(entry.state)
      || typeof entry.zip !== 'string' || !/^\d{5}$/.test(entry.zip)
      || !Number.isSafeInteger(entry.version) || Number(entry.version) < 1
      || !Array.isArray(entry.tasks) || entry.tasks.length < 1 || entry.tasks.length > 3 || !entry.tasks.every(uuid)) return unavailable();
    if (loans.has(entry.loanId) || pipelines.has(entry.pipelineId) || numbers.has(entry.ariveLoanId)) return unavailable();
    loans.add(entry.loanId); pipelines.add(entry.pipelineId); numbers.add(entry.ariveLoanId);
    for (const task of entry.tasks) { if (taskIds.has(task)) return unavailable(); taskIds.add(task); }
    entries.push({ loanId: entry.loanId, pipelineId: entry.pipelineId, oldNumber: entry.oldNumber, ariveLoanId: entry.ariveLoanId,
      borrower: entry.borrower as string, sourceName: entry.sourceName as string, street: entry.street as string, city: entry.city as string,
      state: entry.state, zip: entry.zip, version: Number(entry.version), tasks: [...entry.tasks] });
  }
  if (taskIds.size !== 10) return unavailable();
  return entries;
}
