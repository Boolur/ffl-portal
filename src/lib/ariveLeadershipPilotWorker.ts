import 'server-only';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { AriveError, ariveLeadershipPilotReadSession, readAriveNotes } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
import { ariveRolloutCohortWhere, ariveRolloutJson, rolloutLoanSelect, stableAriveValue } from './ariveRollout';
import { jsonRecord } from './ariveSyncState';
import { corroboratedPilotIdentityHash, isMiddleNamePilotLink, pilotIdentityHash, pilotIdentityMatches } from './ariveLeadershipPilotIdentity';
import { inspectPilotBorrower } from './arivePilotBorrowerMatch';
import { normalizeAriveIdentity } from './ariveIdentity';
import { leadershipPilotProjection, pilotProjectionChanged, PilotMatchReview } from './ariveLeadershipPilotProjection';
import { collectPilotChangeHints, FULL_PILOT_HINT_INTERVAL_MS } from './ariveLeadershipPilotHints';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { readPilotPackage } from './submissionPilot';
import { diagnosticSourceSelect } from './ariveDiagnosticSource';
import { previousPilotReview, priorPilotDiagnostics } from './ariveLeadershipPilotReview';

const CONNECTION = 'company';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const COHORT_FILE_SLOTS = 2;
const FULL_PIPELINE_FILE_SLOTS = 4;
const selectLoan = {
  ...rolloutLoanSelect,
  amount: true,
  propertyAddress: true,
  program: true,
  borrowerPhone: true,
  borrowerEmail: true,
} as const;
const includeFile = {
  pipeline: {
    include: {
      loan: { select: selectLoan },
      ariveSync: {
        select: {
          ariveLoanId: true,
          ariveGuid: true,
          enrollmentStatus: true,
          verifiedOriginatorEmail: true,
          everFunded: true,
        },
      },
    },
  },
} as const;
type Options = {
  pipelineId?: string;
  deadlineMs?: number;
  db?: typeof prisma;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  session?: typeof ariveLeadershipPilotReadSession;
};
type Tx = Prisma.TransactionClient;
const lock = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };
const allowedEnvironment = () => !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production';
class PilotSourceChanged extends Error {}

async function practiceEligibility(
  db: Pick<Tx, 'arivePracticeLoan' | 'task'>,
  row: { sourceTaskId: string; loanId: string },
  number: string,
  guid?: string,
) {
  const registered = await db.arivePracticeLoan.findFirst({
    where: { OR: [{ ariveLoanId: number }, ...(guid ? [{ ariveGuid: guid }] : [])] },
    select: { ariveLoanId: true, ariveGuid: true, enabled: true, label: true, createdById: true },
  });
  const excluded = { allowed: false, guid: null };
  if (
    registered &&
    (!registered.enabled ||
      registered.ariveLoanId !== number ||
      !registered.ariveGuid ||
      (guid && registered.ariveGuid !== guid) ||
      registered.label !== 'Leadership test submission')
  )
    return excluded;
  const request = await db.task.findUnique({
    where: { id: row.sourceTaskId, submissionData: { path: ['leadershipPilotTest'], equals: true } },
    select: { kind: true, loanId: true, submissionData: true },
  });
  if (!request && !registered) return { allowed: true, guid: null };
  const data = jsonRecord(request?.submissionData);
  if (
    request?.kind !== 'SUBMIT_PROCESSING' ||
    request.loanId !== row.loanId ||
    data.leadershipPilotTest !== true ||
    typeof data.processingDocumentTaskId !== 'string'
  )
    return excluded;
  const documentTask = await db.task.findUnique({
    where: { id: data.processingDocumentTaskId },
    select: { kind: true, title: true, loanId: true, submissionData: true },
  });
  const testPackage = readPilotPackage(documentTask?.submissionData);
  if (
    !documentTask ||
    documentTask.kind !== null ||
    documentTask.title !== 'Processing submission pilot — documents' ||
    documentTask.loanId !== row.loanId ||
    !testPackage?.leadershipTest ||
    !testPackage.leadershipSubmitterId ||
    (registered && testPackage.leadershipSubmitterId !== registered.createdById) ||
    !testPackage.ariveLink?.id ||
    (registered && testPackage.ariveLink.id !== registered.ariveGuid) ||
    (guid && testPackage.ariveLink.id !== guid) ||
    testPackage.ariveLink.loanNumber !== number
  )
    return excluded;
  return { allowed: true, guid: testPackage.ariveLink.id };
}

// Seed lightweight private queue rows. Existing Standard tasks, notifications,
// loan rows and enrollment exceptions are only read.
async function discover(db: typeof prisma, now: Date) {
  return db.$transaction(async (tx) => {
    await lock(tx);
    const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
    if (!control?.enabled) return;
    const candidates = await tx.processingPipelineLoan.findMany({
      where: { ...ariveRolloutCohortWhere(now), pilotArive: null },
      select: {
        ...diagnosticSourceSelect,
        ariveSync: {
          select: {
            ...diagnosticSourceSelect.ariveSync.select,
            enrollmentStatus: true,
            enrollmentIssue: true,
            ariveLoanId: true,
            updatedAt: true,
          },
        },
      },
      // Keep this transaction short while submissions and manual refreshes use the
      // same lock. Later runs pick up the remaining rows through pilotArive: null.
      orderBy: [{ sheet: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    if (candidates.length) {
      const config = await tx.ariveIntegrationConfig.findUnique({
        where: { id: CONNECTION },
        select: { updatedAt: true },
      });
      const evidence = config
        ? await priorPilotDiagnostics(
            tx,
            candidates.map((row) => row.id),
            config.updatedAt,
          )
        : [];
      const byId = new Map(evidence.map((entry) => [entry.pipelineId, entry]));
      await tx.pilotAriveProjection.createMany({
        data: candidates.map((row) => {
          const source = {
            ...row,
            ariveSync: row.ariveSync
              ? { ariveGuid: row.ariveSync.ariveGuid, verifiedOriginatorEmail: row.ariveSync.verifiedOriginatorEmail }
              : null,
          };
          const issue = config ? previousPilotReview(source, row.ariveSync, byId.get(row.id), config.updatedAt) : null;
          return {
            pipelineId: row.id,
            ariveLoanId: row.loan.loanNumber,
            ...(issue
              ? {
                  enrollmentStatus: 'REVIEW',
                  enrollmentIssue: issue,
                  // The exception is visible immediately. The regular collector can recheck it;
                  // known exceptions do not consume a small cohort's first verification slots.
                  nextAttemptAt: new Date(+now + HOUR),
                  identityHash: pilotIdentityHash(row.loan),
                  connectionRevision: config!.updatedAt,
                }
              : {}),
          };
        }),
        skipDuplicates: true,
      });
      await tx.pilotAriveControl.update({ where: { id: CONNECTION }, data: { revision: { increment: 1 } } });
    }
    return control.cohortLimit === null;
  }, transactionOptions);
}

/** Caller must first authorize the active Pilot role and the underlying loan. */
export async function requestPilotFileRefresh(
  pipelineId: string,
  options: { watch?: boolean; expectedIdentityHash?: string } = {},
  db: typeof prisma = prisma,
) {
  if (!allowedEnvironment()) return { queued: false, reason: 'UNAVAILABLE' } as const;
  return db.$transaction(async (tx) => {
    await lock(tx);
    const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
    if (!control?.enabled) return { queued: false, reason: 'PAUSED' } as const;
    const row = await tx.processingPipelineLoan.findUnique({
      where: { id: pipelineId },
      select: {
        loan: { select: { ...selectLoan, updatedAt: true } },
        pilotArive: { select: { enrollmentStatus: true, manualRefreshRequestedAt: true, leaseToken: true, leaseUntil: true,
          ariveLoanId: true, identityHash: true, connectionRevision: true, lastAttemptAt: true, nextAttemptAt: true, failureCount: true,
          enrollmentIssue: true, lastError: true } },
      },
    });
    if (!row || (options.expectedIdentityHash && options.expectedIdentityHash !== pilotIdentityHash(row.loan)))
      return { queued: false, reason: 'UNAVAILABLE' } as const;
    if (row.pilotArive?.enrollmentStatus === 'EXCLUDED') return { queued: false, reason: 'EXCLUDED' } as const;
    const now = new Date();
    const reading = Boolean(row.pilotArive?.leaseToken && row.pilotArive.leaseUntil && row.pilotArive.leaseUntil > now);
    if (control.cohortLimit !== null && row.pilotArive?.enrollmentStatus !== 'VERIFIED' && !reading) {
      const reserved = await tx.pilotAriveProjection.count({
        where: { OR: [{ enrollmentStatus: 'VERIFIED' }, { leaseToken: { not: null }, leaseUntil: { gt: now } }] },
      });
      if (reserved >= control.cohortLimit) return { queued: false, reason: 'COHORT_FULL' } as const;
    }
    if (reading && !options.watch) return { queued: false, reason: 'IN_PROGRESS' } as const;
    const previous = row.pilotArive;
    let recheckCorrectedFile = false;
    if (!options.watch && previous?.nextAttemptAt && previous.nextAttemptAt > now &&
        (previous.enrollmentStatus === 'REVIEW' || previous.failureCount > 0)) {
      // A prior failure applies to the identity and connection that were checked.
      // An explicit Sync can retry a correction. Ordinary retries, passive
      // watching and all provider-wide limits continue to use their normal gates.
      const identityChanged = previous.ariveLoanId !== row.loan.loanNumber ||
        (previous.identityHash !== null && !pilotIdentityMatches(row.loan, previous.identityHash));
      recheckCorrectedFile = identityChanged && (!previous.lastAttemptAt || row.loan.updatedAt > previous.lastAttemptAt);
      if (!recheckCorrectedFile) {
        const config = await tx.ariveIntegrationConfig.findUnique({ where: { id: CONNECTION }, select: { updatedAt: true } });
        const lastCheck = previous.lastAttemptAt ?? previous.connectionRevision;
        recheckCorrectedFile = !!config && !!lastCheck && config.updatedAt > lastCheck;
        if (!recheckCorrectedFile && config && previous.enrollmentStatus === 'REVIEW' &&
            previous.enrollmentIssue === 'Arive loan, borrower or originator did not match.' && previous.lastError === previous.enrollmentIssue) {
          const [prior] = await priorPilotDiagnostics(tx, [pipelineId], config.updatedAt);
          recheckCorrectedFile = prior?.borrowerOnly === true && prior.loanId === row.loan.id &&
            prior.number === row.loan.loanNumber && prior.outcome === 'IDENTITY_MISMATCH';
        }
      }
    }
    const data = options.watch
      ? { watchedUntil: new Date(+now + 2 * MINUTE) }
      : { manualRefreshRequestedAt: previous?.manualRefreshRequestedAt ?? now, ...(recheckCorrectedFile && { nextAttemptAt: now }) };
    await tx.pilotAriveProjection.upsert({
      where: { pipelineId },
      create: { pipelineId, ariveLoanId: row.loan.loanNumber, ...data },
      update: data,
    });
    return { queued: true } as const;
  });
}

function isEligible(file: { sheet: string; archivedAt: Date | null; fundedAt: Date | null }, now: Date) {
  return (
    !file.archivedAt &&
    (file.sheet === 'PIPELINE' ||
      file.sheet === 'RESTRUCTURE' ||
      (file.sheet === 'FUNDING' && (!file.fundedAt || +file.fundedAt >= +now - 90 * 24 * HOUR)))
  );
}

async function claim(db: typeof prisma, now: Date, pipelineId: string | undefined, preferWatched: boolean) {
  return db.$transaction(async (tx) => {
    await lock(tx);
    // Read the cohort slots, global lease slots and connection revision in one
    // snapshot after acquiring the same lock used by the operator and publishers.
    const [capacity] = await tx.$queryRaw<Array<{
      generation: number; cohortLimit: number | null; revision: Date; active: number; reserved: number;
    }>>`
      SELECT c.generation,c."cohortLimit",a."updatedAt" AS revision,slots.active,slots.reserved
      FROM "PilotAriveControl" c JOIN "AriveIntegrationConfig" a ON a.id=c.id
      CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE p."leaseToken" IS NOT NULL AND p."leaseUntil">${now})::int AS active,
               COUNT(*)::int AS reserved
        FROM "PilotAriveProjection" p
        WHERE p."enrollmentStatus"='VERIFIED' OR (p."leaseToken" IS NOT NULL AND p."leaseUntil">${now})
      ) slots
      WHERE c.id=${CONNECTION} AND c.enabled`;
    if (!capacity) return null;
    const fileSlots = capacity.cohortLimit === null ? FULL_PIPELINE_FILE_SLOTS : COHORT_FILE_SLOTS;
    if (capacity.active >= fileSlots) return 'occupied' as const;
    const statuses =
      capacity.cohortLimit !== null && capacity.reserved >= capacity.cohortLimit
        ? ['VERIFIED']
        : ['PENDING', 'VERIFIED', 'REVIEW'];
    const eligible: Prisma.PilotAriveProjectionWhereInput = {
      ...(pipelineId ? { pipelineId } : {}),
      enrollmentStatus: { in: statuses },
      AND: [
        { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
            { manualRefreshRequestedAt: { not: null }, failureCount: 0 },
            { hintRequestedAt: { not: null }, failureCount: 0 },
          ],
        },
        { OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: new Date(+now - 10_000) } }] },
        {
          OR: [
            { pipeline: ariveRolloutCohortWhere(now) },
            { manualRefreshRequestedAt: { not: null } },
            { enrollmentStatus: 'VERIFIED', routingProvenance: { path: ['kind'], equals: 'ARCHIVE' } },
          ],
        },
      ],
    };
    const order: Prisma.PilotAriveProjectionOrderByWithRelationInput[] = [
      // A new file has no due time until its first attempt. On a large rollout
      // one lane admits these files while the other keeps serving due refreshes.
      // Either lane can take the other's work when its own queue is empty.
      { nextAttemptAt: { sort: 'asc', nulls: preferWatched ? 'last' : 'first' } },
      // Within the initial backlog, start with the active book, then Restructures
      // and Fundings. Dated attempts still take their ordinary due-time order.
      { pipeline: { sheet: 'asc' } },
      { createdAt: 'asc' },
      { pipelineId: 'asc' },
    ];
    const priority = {
      OR: [
        { manualRefreshRequestedAt: { not: null } },
        { watchedUntil: { gt: now } },
        { hintRequestedAt: { not: null } },
      ],
    };
    const prioritized =
      preferWatched && !pipelineId
        ? await tx.pilotAriveProjection.findFirst({
            where: { AND: [eligible, priority] },
            orderBy: [
              { manualRefreshRequestedAt: { sort: 'asc', nulls: 'last' } },
              { hintRequestedAt: { sort: 'asc', nulls: 'last' } },
              ...order,
            ],
            include: includeFile,
          })
        : null;
    const row =
      prioritized ??
      (await tx.pilotAriveProjection.findFirst({ where: eligible, orderBy: order, include: includeFile }));
    if (!row) return null;
    const token = randomUUID();
    await tx.pilotAriveProjection.update({
      where: { pipelineId: row.pipelineId },
      data: {
        leaseToken: token,
        leaseUntil: new Date(+now + 3 * MINUTE),
        lastAttemptAt: now,
        manualRefreshRequestedAt: null,
        hintRequestedAt: null,
      },
    });
    return { row, revision: capacity.revision, started: now, token, generation: capacity.generation };
  }, transactionOptions);
}
type Claim = Exclude<Awaited<ReturnType<typeof claim>>, null | 'occupied'>;

/** Caller holds the collector lock. Both a published snapshot and new review
 * evidence must still describe the same loan, connection and unexpired lease. */
async function currentPilotSource(tx: Tx, job: Claim, matchHash: string, clock: () => Date) {
  const { row, token } = job;
  const [publication] = await tx.$queryRaw<Array<{ generation: number; revision: Date }>>`
    SELECT c.generation,a."updatedAt" AS revision
    FROM "AriveIntegrationConfig" a JOIN "PilotAriveControl" c ON c.id=a.id
    CROSS JOIN "ProcessingPipelineLoan" p JOIN "Loan" l ON l.id=p."loanId"
    WHERE a.id=${CONNECTION} AND c.enabled AND p.id=${row.pipelineId} AND l.id=${row.pipeline.loan.id}
    FOR SHARE OF a,p,l`;
  const current = await tx.pilotAriveProjection.findUnique({ where: { pipelineId: row.pipelineId }, include: includeFile });
  const now = clock();
  if (!publication || publication.generation !== job.generation || +publication.revision !== +job.revision ||
      !current || current.leaseToken !== token || !current.leaseUntil || current.leaseUntil <= now ||
      current.projectionVersion !== row.projectionVersion || pilotIdentityHash(current.pipeline.loan) !== matchHash ||
      (!isEligible(current.pipeline, now) && !row.manualRefreshRequestedAt && jsonRecord(current.routingProvenance).kind !== 'ARCHIVE')) return null;
  return {current, now};
}

async function collect(db: typeof prisma, job: Claim, options: Options) {
  const { row, started, token } = job;
  const clock = options.now ?? (() => new Date());
  const loan = row.pipeline.loan;
  const number = loan.loanNumber;
  const matchHash = pilotIdentityHash(loan);
  const owner = { pipelineId: row.pipelineId, leaseToken: token };
  const validOld =
    row.collectedAt &&
    row.ariveLoanId === number &&
    pilotIdentityMatches(loan, row.identityHash) &&
    row.connectionRevision?.getTime() === job.revision.getTime();
  let excluded = false;
  let checkedBorrowerEvidence = false;
  try {
    const practice = await practiceEligibility(db, row.pipeline, number);
    if (!practice.allowed) {
      excluded = true;
      throw new PilotMatchReview('Registered practice file.');
    }
    if (!/^\d{1,15}$/.test(number)) throw new PilotMatchReview('Missing a confirmed numeric Arive loan number.');
    if (row.pipeline.sheet === 'FUNDING' && !row.pipeline.fundedAt)
      throw new PilotMatchReview('A funding date is required to verify eligibility.');
    if ((await db.loan.count({ where: { loanNumber: number } })) !== 1)
      throw new PilotMatchReview('Multiple portal records use this Arive number.');
    const session = await (options.session ?? ariveLeadershipPilotReadSession)();
    const api: typeof session = async (path, body, method) => {
      if (body || method || !path.startsWith('/loans')) throw new Error('READ_ONLY');
      if (Date.now() >= (options.deadlineMs ?? Infinity) - 20_000)
        throw new AriveTransportError('WORKER_DEADLINE', 'Retry on the next worker run.', new Date(+clock() + 5_000));
      try {
        return await session(path);
      } catch (error) {
        if (error instanceof AriveError && /^Arive API request returned HTTP 403\b/.test(error.message))
          throw new PilotMatchReview('Arive returned HTTP 403. The branch connection was denied access to this loan.');
        if (error instanceof AriveError && /^Arive API request returned HTTP 404\b/.test(error.message))
          throw new PilotMatchReview('Arive returned HTTP 404. The requested loan or resource was unavailable.');
        throw error;
      }
    };
    const canonicalLink = row.pipeline.ariveSync;
    const pinned = validOld
      ? row
      : canonicalLink?.enrollmentStatus === 'VERIFIED' && canonicalLink.ariveLoanId === number
        ? canonicalLink
        : null;
    let guid = practice.guid ?? pinned?.ariveGuid;
    if (practice.guid && pinned?.ariveGuid && practice.guid !== pinned.ariveGuid)
      throw new PilotMatchReview('The test package and existing verified loan reference disagree.');
    if (!guid) {
      const found = await api(
        `/loans?searchField=DISPLAY_ID&searchValue=${encodeURIComponent(number)}&limit=100&offset=0`,
      );
      if (
        !Array.isArray(found.rows) ||
        found.rows.length >= 100 ||
        (found.count !== undefined && found.count !== found.rows.length)
      )
        throw new PilotMatchReview('Arive search was incomplete.');
      const matches = found.rows
        .map(jsonRecord)
        .filter((entry: Record<string, unknown>) => String(entry.ariveLoanId) === number);
      if (!matches.length) throw new PilotMatchReview('No exact loan number was found on the branch connection.');
      if (matches.length > 1) throw new PilotMatchReview('Arive returned multiple files with the exact loan number.');
      guid = matches[0].sysGUID;
    }
    if (typeof guid !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(guid))
      throw new PilotMatchReview('Missing a valid permanent Arive loan ID.');
    if (!(await practiceEligibility(db, row.pipeline, number, guid)).allowed) {
      excluded = true;
      throw new PilotMatchReview('Registered practice file.');
    }
    const path = `/loans/${encodeURIComponent(guid)}`;
    const details = await api(path);
    const sourceModifiedAt = parseArivePipelineDate(jsonRecord(details).modifiedDateTime);
    if (validOld && sourceModifiedAt && row.sourceModifiedAt && sourceModifiedAt < row.sourceModifiedAt)
      throw new Error('REGRESSED');
    if (row.collectedAt && isMiddleNamePilotLink(row.identityHash) && number === row.ariveLoanId && guid !== row.ariveGuid)
      throw new PilotMatchReview('The permanent Arive file ID for the previously corroborated loan changed.');
    const { identity, middleName, expected } = inspectPilotBorrower(details, loan, {
      ariveGuid: guid,
      verifiedOriginatorEmail: pinned?.verifiedOriginatorEmail,
    });
    if (identity.issues.length === 1 && identity.issues[0] === 'BORROWER_NAME') {
      checkedBorrowerEvidence = true;
      throw new PilotMatchReview('The borrower name differs. The primary borrower’s middle name, full subject property, loan amount and contact did not verify the link.');
    }
    if (identity.issues.length) throw new PilotMatchReview('The permanent Arive ID, loan number, or assigned originator did not verify the link.');
    if (middleName && row.collectedAt && isMiddleNamePilotLink(row.identityHash) && row.ariveLoanId === number) {
      const linked = jsonRecord(jsonRecord(row.snapshot).canonicalLoan);
      if (expected !== normalizeAriveIdentity(`${linked.borrowerFirstName ?? ''} ${linked.borrowerLastName ?? ''}`))
        throw new PilotMatchReview('The primary borrower on the previously corroborated Arive file changed.');
    }
    const trackers = await api(`${path}/trackers`);
    const notes = await readAriveNotes(guid, api);
    if (stableAriveValue(details) !== stableAriveValue(await api(path)))
      throw new PilotSourceChanged('Arive loan details changed during this read. The last complete snapshot was retained.');
    const permanentGuid = guid;
    return await db.$transaction(async (tx) => {
      await lock(tx);
      const source = await currentPilotSource(tx, job, matchHash, clock);
      if (!source || !(await practiceEligibility(tx, source.current.pipeline, number, permanentGuid)).allowed) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return 'held' as const;
      }
      const { current, now } = source;
      if (middleName && corroboratedPilotIdentityHash(loan) !== corroboratedPilotIdentityHash(current.pipeline.loan)) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return 'held' as const;
      }
      const projected = leadershipPilotProjection({
        current: current.pipeline,
        loan: current.pipeline.loan,
        prior: validOld || (middleName && current.collectedAt && isMiddleNamePilotLink(current.identityHash) && current.ariveGuid === permanentGuid &&
          current.connectionRevision?.getTime() === job.revision.getTime()) ? current : null,
        previousVersion: current.projectionVersion,
        guid: permanentGuid,
        details,
        trackers,
        notes,
        now,
        started,
        financialHistoryProtected:
          current.pipeline.loan.payrollCompRequests.length > 0 || current.pipeline.ariveSync?.everFunded === true,
      });
      const quiet = projected.sheet === 'FUNDING' || !!projected.archivedAt;
      const changed = pilotProjectionChanged(validOld ? current : null, projected);
      const next = current.watchedUntil && current.watchedUntil > now ? 10_000 : quiet ? HOUR : 30_000;
      await tx.pilotAriveProjection.update({
        where: { pipelineId: row.pipelineId },
        data: {
          ...(changed
            ? {
                ...projected,
                snapshot: ariveRolloutJson(projected.snapshot),
                notes: ariveRolloutJson(projected.notes),
                routingProvenance: ariveRolloutJson(projected.routingProvenance),
              }
            : {}),
          ariveLoanId: number,
          identityHash: middleName ? corroboratedPilotIdentityHash(current.pipeline.loan) : matchHash,
          connectionRevision: job.revision,
          enrollmentStatus: 'VERIFIED',
          enrollmentIssue: null,
          collectedAt: now,
          sourceModifiedAt,
          lastError: null,
          failureCount: 0,
          leaseUntil: null,
          leaseToken: null,
          // Read duration already consumes the polling interval. Keep the start
          // cadence without imposing a second full interval after publication.
          nextAttemptAt: new Date(Math.max(+now, +started + next)),
        },
      });
      if (changed || current.lastError || current.failureCount) {
        await tx.pilotAriveControl.update({ where: { id: CONNECTION }, data: { revision: { increment: 1 } } });
      }
      return 'verified' as const;
    }, transactionOptions);
  } catch (error) {
    const review = error instanceof PilotMatchReview;
    const deferred = error instanceof AriveTransportError;
    const now = clock();
    const changedDuringRead = error instanceof PilotSourceChanged;
    const message = review || changedDuringRead
      ? error.message
      : deferred
        ? `Arive collection deferred (${error.code}).`
        : 'Could not complete this Arive read.';
    const retry =
      deferred && error.retryAt && error.retryAt > now
        ? error.retryAt
        : new Date(+now + (review ? 24 * HOUR : Math.min(HOUR, (changedDuringRead ? 2_000 : 30_000) * 2 ** Math.min(row.failureCount, 6))));
    await db.$transaction(async (tx) => {
      await lock(tx);
      const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
      if (!control?.enabled || control.generation !== job.generation) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return;
      }
      const source = review ? await currentPilotSource(tx, job, matchHash, clock) : null;
      if (review && (!source || (checkedBorrowerEvidence && corroboratedPilotIdentityHash(source.current.pipeline.loan) !== corroboratedPilotIdentityHash(loan)))) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return;
      }
      const changed = await tx.pilotAriveProjection.updateMany({
        where: owner,
        data: {
          ...(review ? { enrollmentStatus: excluded ? 'EXCLUDED' : 'REVIEW', enrollmentIssue: message } : {}),
          ...(source && !source.current.collectedAt
            ? { ariveLoanId: number, identityHash: checkedBorrowerEvidence ? corroboratedPilotIdentityHash(loan) : matchHash, connectionRevision: job.revision } : {}),
          lastError: message,
          failureCount: { increment: 1 },
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: retry,
        },
      });
      if (changed.count) {
        if (row.manualRefreshRequestedAt && deferred)
          await tx.pilotAriveProjection.updateMany({
            where: { pipelineId: row.pipelineId, manualRefreshRequestedAt: null },
            data: { manualRefreshRequestedAt: row.manualRefreshRequestedAt },
          });
        await tx.pilotAriveControl.update({ where: { id: CONNECTION }, data: { revision: { increment: 1 } } });
      }
    });
    if (deferred && error.code === 'BUSY') return 'busy' as const;
    return deferred ? ('deferred' as const) : ('held' as const);
  }
}

/** No viewer is required. One priority lane plus an oldest-due lane preserves
 * progress on quiet files even when several people watch or request refreshes. */
export async function runLeadershipPilotCollection(options: Options = {}) {
  const db = options.db ?? prisma,
    now = options.now ?? (() => new Date());
  let checked = 0,
    succeeded = 0,
    deferred = 0;
  let stopAdmission = false;
  let fullPipeline = false;
  let nextHintScanMs = 0;
  const deadlineMs = options.deadlineMs ?? Date.now() + 110_000;
  const handoffUntil = Math.min(deadlineMs - 30_000, Date.now() + 55_000);
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let handoff: Promise<boolean> | undefined;
  if (!allowedEnvironment() || Date.now() >= deadlineMs - 30_000) return { checked, succeeded, deferred };
  async function scanRecentChanges() {
    const sampledAt = now();
    nextHintScanMs = +sampledAt + FULL_PILOT_HINT_INTERVAL_MS;
    try {
      const due = await collectPilotChangeHints(db, sampledAt, options.session ?? ariveLeadershipPilotReadSession);
      if (due) nextHintScanMs = +due;
    } catch {
      /* An unavailable hint feed cannot suppress the fair reconciliation sweep. */
    }
  }
  if (!options.pipelineId) {
    fullPipeline = (await discover(db, now())) === true;
    await scanRecentChanges();
  }
  // Only a scheduled, full-volume worker scans between cron starts. Stop its
  // timer immediately when the file lanes drain. Each scan still requires the
  // shared database claim across all invocations and both transport slots.
  const hintTimer = new AbortController();
  async function followRecentChanges() {
    while (fullPipeline && !stopAdmission && !hintTimer.signal.aborted) {
      const delay = Math.max(20, nextHintScanMs - +now());
      if (Date.now() + delay >= deadlineMs - 30_000) return;
      try {
        await wait(delay, undefined, { signal: hintTimer.signal });
      } catch (error) {
        if (hintTimer.signal.aborted) return;
        throw error;
      }
      if (stopAdmission || hintTimer.signal.aborted || Date.now() >= deadlineMs - 30_000) return;
      await scanRecentChanges();
    }
  }
  async function waitForHandoff() {
    // A new minute's cron can arrive while the previous lanes are all leased.
    // Keep a single standby shared by this invocation's lanes until one opens.
    // This SELECT is only a wake-up hint. Admission still takes the worker lock.
    // An explicit bounded sample count also handles delayed or stationary clocks.
    for (let sample = 0; sample < 10 && !stopAdmission && Date.now() < handoffUntil; sample++) {
      const sampledAt = now();
      const [state] = await db.$queryRaw<Array<{ open: boolean }>>`
        SELECT (SELECT COUNT(*) FROM "PilotAriveProjection" leased WHERE leased."leaseToken" IS NOT NULL
                  AND leased."leaseUntil">${sampledAt}) <
               CASE WHEN c."cohortLimit" IS NULL THEN ${FULL_PIPELINE_FILE_SLOTS} ELSE ${COHORT_FILE_SLOTS} END AS open
        FROM "PilotAriveControl" c WHERE c.id=${CONNECTION} AND c.enabled
          AND EXISTS (SELECT 1 FROM "PilotAriveProjection" p WHERE p."enrollmentStatus"='VERIFIED'
            AND ((p."archivedAt" IS NULL AND p.sheet IN ('PIPELINE','RESTRUCTURE'))
                 OR p."watchedUntil">${sampledAt} OR p."manualRefreshRequestedAt" IS NOT NULL)
            AND (p."nextAttemptAt"<=${new Date(+sampledAt + 30_000)} OR p."nextAttemptAt" IS NULL))`;
      if (!state) return false;
      if (state.open) return true;
      const delay = Math.min(6000, handoffUntil - Date.now());
      if (delay <= 0) break;
      await sleep(delay);
    }
    return false;
  }
  async function drain(preferWatched: boolean) {
    // The transport checks the saved credentials, current token, generation,
    // global HTTP slots and provider limits at every request. Reuse its session
    // in this sequential lane to avoid starting a new one for each loan.
    let connected: ReturnType<typeof ariveLeadershipPilotReadSession> | undefined;
    const session = () => connected ??= (options.session ?? ariveLeadershipPilotReadSession)().catch(error => {
      connected = undefined;
      throw error;
    });
    while (!stopAdmission && Date.now() < deadlineMs - 30_000 && checked < 500) {
      const job = await claim(db, now(), options.pipelineId, preferWatched);
      if (job === 'occupied') {
        if (options.pipelineId || Date.now() >= handoffUntil) break;
        handoff ??= waitForHandoff().finally(() => { handoff = undefined; });
        if (!await handoff) break;
        continue;
      }
      if (!job) {
        if (!preferWatched || options.pipelineId) break;
        // A small cohort can finish every due job between cron ticks. Wake
        // once its next verified file is due instead of waiting a full minute.
        // Overlapping invocations still compete through the same locked claim.
        const sampledAt = now();
        const [upcoming] = await db.$queryRaw<Array<{ due: Date }>>`
          SELECT p."nextAttemptAt" AS due FROM "PilotAriveProjection" p
          JOIN "PilotAriveControl" c ON c.id=${CONNECTION} AND c.enabled
          WHERE p."enrollmentStatus"='VERIFIED' AND p."nextAttemptAt">${sampledAt}
            AND p."nextAttemptAt"<=${new Date(+sampledAt+30_000)}
            AND (p."leaseToken" IS NULL OR p."leaseUntil"<=${sampledAt})
            AND (SELECT COUNT(*) FROM "PilotAriveProjection" active WHERE active."leaseToken" IS NOT NULL
                 AND active."leaseUntil">${sampledAt}) <
                CASE WHEN c."cohortLimit" IS NULL THEN ${FULL_PIPELINE_FILE_SLOTS} ELSE ${COHORT_FILE_SLOTS} END
          ORDER BY p."nextAttemptAt" LIMIT 1`;
        if (!upcoming) break;
        const delay = Math.max(50, +upcoming.due - +now());
        if (Date.now() + delay >= deadlineMs - 30_000) break;
        await sleep(delay);
        continue;
      }
      checked++;
      const result = await collect(db, job, { ...options, deadlineMs, session });
      if (result === 'verified') succeeded++;
      if (result === 'busy') {
        // A local HTTP slot wait timed out. Retire this lane; other lanes may
        // already hold the slots and should finish serving the queue.
        deferred++;
        break;
      }
      if (result === 'deferred') {
        deferred++;
        stopAdmission = true;
      }
      if (options.pipelineId) break;
    }
  }
  // At full volume, overlap the database checks and publication of two
  // additional files with the two globally reserved provider HTTP slots.
  // Each pair has one priority lane and one fair enrollment/sweep lane.
  const lanes = [drain(true)];
  if (!options.pipelineId) lanes.push(drain(false));
  if (fullPipeline) lanes.push(drain(true), drain(false));
  const hints = followRecentChanges();
  const completed = await Promise.allSettled(lanes).finally(() => hintTimer.abort());
  await hints;
  const failed = completed.find((lane) => lane.status === 'rejected');
  if (failed) throw failed.reason;
  return { checked, succeeded, deferred };
}
