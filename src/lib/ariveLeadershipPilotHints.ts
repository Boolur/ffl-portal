import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ariveLeadershipPilotReadSession } from './ariveClient';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { jsonRecord } from './ariveSyncState';

// A sorted page is only a hint. Missing records never move a verification
// cursor or postpone the ordinary details, tracker and notes checks.
export function parsePilotChangeHints(payload: unknown) {
  const data = jsonRecord(payload);
  if (
    !Array.isArray(data.rows) ||
    data.rows.length > 100 ||
    !Number.isSafeInteger(data.count) ||
    Number(data.count) < data.rows.length
  )
    return [];
  const entries = new Map<string, { number: string; guid: string; modified: Date }>();
  const ambiguous = new Set<string>();
  for (const item of data.rows) {
    const row = jsonRecord(item);
    const number = String(row.ariveLoanId),
      guid = row.sysGUID,
      modified = parseArivePipelineDate(row.modifiedDateTime);
    if (!/^\d{1,15}$/.test(number) || typeof guid !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(guid) || !modified)
      continue;
    if (entries.has(number) && entries.get(number)!.guid !== guid) ambiguous.add(number);
    if (!entries.has(number) || entries.get(number)!.modified < modified)
      entries.set(number, { number, guid, modified });
  }
  return [...entries.values()].filter((entry) => !ambiguous.has(entry.number));
}

export async function collectPilotChangeHints(
  db: typeof prisma,
  now: Date,
  session: typeof ariveLeadershipPilotReadSession,
) {
  const claim = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
    const control = await tx.pilotAriveControl.findUnique({ where: { id: 'company' } });
    if (!control?.enabled || (control.lastHintScanAt && +now - +control.lastHintScanAt < 60_000)) return null;
    if (
      !(await tx.pilotAriveProjection.findFirst({
        where: { enrollmentStatus: 'VERIFIED' },
        select: { pipelineId: true },
      }))
    )
      return null;
    await tx.pilotAriveControl.update({ where: { id: 'company' }, data: { lastHintScanAt: now } });
    const connection = await tx.ariveIntegrationConfig.findUnique({
      where: { id: 'company' },
      select: { updatedAt: true },
    });
    return connection && { generation: control.generation, connectionAt: connection.updatedAt };
  });
  if (!claim) return;
  const api = await session();
  const hints = parsePilotChangeHints(await api('/loans?limit=100&offset=0&orderBy=updatedAt&sort=DESC'));
  if (!hints.length) return;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
    const control = await tx.pilotAriveControl.findUnique({ where: { id: 'company' } });
    const connection = await tx.ariveIntegrationConfig.findUnique({
      where: { id: 'company' },
      select: { updatedAt: true },
    });
    if (
      !control?.enabled ||
      control.generation !== claim.generation ||
      connection?.updatedAt.getTime() !== claim.connectionAt.getTime()
    )
      return;
    // Even a valid hint may only queue an independently verified existing link;
    // the exact number/GUID pair, credential revision and cooldown must match.
    await tx.$executeRaw`
      UPDATE "PilotAriveProjection" p
      SET "lastHintModifiedAt"=h.modified, "hintRequestedAt"=COALESCE(p."hintRequestedAt",${now}),
          "nextAttemptAt"=LEAST(p."nextAttemptAt",${now})
      FROM (VALUES ${Prisma.join(hints.map((h) => Prisma.sql`(${h.number}::text,${h.guid}::text,${h.modified}::timestamp)`))})
        AS h(num,guid,modified)
      WHERE p."enrollmentStatus"='VERIFIED' AND p."ariveLoanId"=h.num AND p."ariveGuid"=h.guid
        AND p."connectionRevision"=${claim.connectionAt} AND p."failureCount"=0
        AND (p."sourceModifiedAt" IS NULL OR p."sourceModifiedAt"<h.modified)
        AND (p."lastHintModifiedAt" IS NULL OR p."lastHintModifiedAt"<h.modified)`;
  });
}
