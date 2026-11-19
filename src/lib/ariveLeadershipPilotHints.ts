import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ariveLeadershipPilotReadSession } from './ariveClient';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { jsonRecord } from './ariveSyncState';

export const FULL_PILOT_HINT_INTERVAL_MS = 20_000;
const STAGE_RECHECK_MS = 5 * 60_000;
function stageCode(value: unknown) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/[-\s]+/g, '_');
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : null;
}
type Hint = { number: string; guid: string; modified: Date; stage: string | null };

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
  const entries = new Map<string, Hint>();
  const ambiguous = new Set<string>();
  for (const item of data.rows) {
    const row = jsonRecord(item);
    const number = String(row.ariveLoanId),
      guid = row.sysGUID,
      modified = parseArivePipelineDate(row.modifiedDateTime);
    if (!/^\d{1,15}$/.test(number) || typeof guid !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(guid) || !modified)
      continue;
    const stage = stageCode(jsonRecord(row.currentLoanStatus).status);
    const previous = entries.get(number);
    if (previous && (previous.guid !== guid ||
      (+previous.modified === +modified && previous.stage && stage && previous.stage !== stage))) ambiguous.add(number);
    if (!previous || previous.modified < modified || (+previous.modified === +modified && !previous.stage && stage))
      entries.set(number, { number, guid, modified, stage });
  }
  return [...entries.values()].filter((entry) => !ambiguous.has(entry.number));
}

function needsRead(file: {
  ariveGuid: string | null; sourceModifiedAt: Date | null; sourceStage: string | null; lastHintModifiedAt: Date | null;
  hintRequestedAt: Date | null; lastAttemptAt: Date | null;
}, hint: Hint, fullPipeline: boolean, now: Date) {
  if (file.ariveGuid !== hint.guid || (file.sourceModifiedAt && file.sourceModifiedAt > hint.modified) ||
    (file.lastHintModifiedAt && file.lastHintModifiedAt > hint.modified)) return false;
  const newHint = !file.lastHintModifiedAt || file.lastHintModifiedAt < hint.modified;
  if (!file.sourceModifiedAt || file.sourceModifiedAt < hint.modified) return newHint;
  // A stale list cannot roll a loan back. For the same source time, a different
  // stage only schedules an independent read. If the list keeps disagreeing,
  // recheck at most once per five minutes and never stack duplicate requests.
  if (!fullPipeline || !hint.stage || stageCode(file.sourceStage) === hint.stage) return false;
  return newHint || (!file.hintRequestedAt && (!file.lastAttemptAt || +now - +file.lastAttemptAt >= STAGE_RECHECK_MS));
}

export async function collectPilotChangeHints(
  db: typeof prisma,
  now: Date,
  session: typeof ariveLeadershipPilotReadSession,
) {
  const claim = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
    const control = await tx.pilotAriveControl.findUnique({ where: { id: 'company' } });
    if (!control?.enabled) return null;
    const fullPipeline = control.cohortLimit === null;
    const interval = fullPipeline ? FULL_PILOT_HINT_INTERVAL_MS : 60_000;
    if (control.lastHintScanAt && +now - +control.lastHintScanAt < interval)
      return { skipped: true as const, nextScan: new Date(+control.lastHintScanAt + interval) };
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
    return connection && { skipped: false as const, nextScan: new Date(+now + interval),
      generation: control.generation, connectionAt: connection.updatedAt, fullPipeline };
  });
  if (!claim) return null;
  if (claim.skipped) return claim.nextScan;
  const api = await session();
  const hints = parsePilotChangeHints(await api('/loans?limit=100&offset=0&orderBy=updatedAt&sort=DESC'));
  if (!hints.length) return claim.nextScan;
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
      control.lastHintScanAt?.getTime() !== now.getTime() ||
      connection?.updatedAt.getTime() !== claim.connectionAt.getTime()
    )
      return;
    // Selection and enqueue share the collector/publisher lock. Only verified
    // links on the current connection are eligible, including on a stage signal.
    const byNumber = new Map(hints.map(hint => [hint.number, hint]));
    const files = await tx.pilotAriveProjection.findMany({
      where: { enrollmentStatus: 'VERIFIED', connectionRevision: claim.connectionAt, failureCount: 0,
        ariveLoanId: { in: [...byNumber.keys()] } },
      select: { pipelineId: true, ariveLoanId: true, ariveGuid: true, sourceModifiedAt: true, sourceStage: true,
        lastHintModifiedAt: true, hintRequestedAt: true, lastAttemptAt: true },
    });
    const updates = files.flatMap(file => {
      const hint = byNumber.get(file.ariveLoanId);
      return hint && needsRead(file, hint, claim.fullPipeline, now) ? [Prisma.sql`(${file.pipelineId}::text,${hint.modified}::timestamp)`] : [];
    });
    if (!updates.length) return;
    await tx.$executeRaw`
      UPDATE "PilotAriveProjection" p
      SET "lastHintModifiedAt"=h.modified, "hintRequestedAt"=COALESCE(p."hintRequestedAt",${now}),
          "nextAttemptAt"=LEAST(p."nextAttemptAt",${now})
      FROM (VALUES ${Prisma.join(updates)}) AS h(id,modified)
      WHERE p."pipelineId"=h.id`;
  });
  return claim.nextScan;
}
