import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { AriveError, ariveLeadershipPilotReadSession, readAriveNotes } from './ariveClient';
import { AriveTransportError } from './ariveTransport';
import { ariveRolloutCohortWhere, ariveRolloutJson, rolloutLoanSelect, stableAriveValue } from './ariveRollout';
import { jsonRecord } from './ariveSyncState';
import { pilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { inspectAriveLoanIdentity } from './ariveIdentity';
import { leadershipPilotProjection, pilotProjectionChanged, PilotMatchReview } from './ariveLeadershipPilotProjection';
import { collectPilotChangeHints } from './ariveLeadershipPilotHints';
import { parseArivePipelineDate } from './arivePipelineMapping';
import { readPilotPackage } from './submissionPilot';
import { diagnosticSourceSelect } from './ariveDiagnosticSource';
import { previousPilotReview, priorPilotDiagnostics } from './ariveLeadershipPilotReview';

const CONNECTION = 'company';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
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
  session?: typeof ariveLeadershipPilotReadSession;
};
type Tx = Prisma.TransactionClient;
const lock = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
const transactionOptions = { maxWait: 10_000, timeout: 20_000 };
const allowedEnvironment = () => !process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production';

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
      // Materialize current coverage across the whole active pipeline even
      // when the operator admits only ten files for provider collection.
      orderBy: [{sheet:'asc'}, {createdAt:'desc'}],
      take: 1000,
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
  }, transactionOptions);
}

/** Caller must first authorize the active Pilot role and the underlying loan. */
export async function requestPilotFileRefresh(
  pipelineId: string,
  options: { watch?: boolean; expectedIdentityHash?: string } = {},
) {
  if (!allowedEnvironment()) return { queued: false };
  return prisma.$transaction(async (tx) => {
    await lock(tx);
    const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
    if (!control?.enabled) return { queued: false };
    const row = await tx.processingPipelineLoan.findUnique({
      where: { id: pipelineId },
      select: {
        loan: { select: rolloutLoanSelect },
        pilotArive: { select: { enrollmentStatus: true, manualRefreshRequestedAt: true } },
      },
    });
    if (!row || (options.expectedIdentityHash && options.expectedIdentityHash !== pilotIdentityHash(row.loan)))
      return { queued: false };
    if (row.pilotArive?.enrollmentStatus === 'EXCLUDED') return { queued: false };
    const now = new Date();
    const data = options.watch
      ? { watchedUntil: new Date(+now + 2 * MINUTE) }
      : { manualRefreshRequestedAt: row.pilotArive?.manualRefreshRequestedAt ?? now };
    await tx.pilotAriveProjection.upsert({
      where: { pipelineId },
      create: { pipelineId, ariveLoanId: row.loan.loanNumber, ...data },
      update: data,
    });
    return { queued: true };
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
    const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
    if (!control?.enabled) return null;
    const leased = { leaseUntil: { gt: now }, leaseToken: { not: null } };
    const active = await tx.pilotAriveProjection.count({ where: leased });
    if (active >= 2) return null;
    const reserved =
      control.cohortLimit === null
        ? 0
        : await tx.pilotAriveProjection.count({
            where: { OR: [{ enrollmentStatus: 'VERIFIED' }, leased] },
          });
    const statuses =
      control.cohortLimit !== null && reserved >= control.cohortLimit
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
      { nextAttemptAt: { sort: 'asc', nulls: 'first' } },
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
            orderBy: order,
            include: includeFile,
          })
        : null;
    const row =
      prioritized ??
      (await tx.pilotAriveProjection.findFirst({ where: eligible, orderBy: order, include: includeFile }));
    if (!row) return null;
    const revision = await tx.ariveIntegrationConfig.findUnique({
      where: { id: CONNECTION },
      select: { updatedAt: true },
    });
    if (!revision) return null;
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
    return { row, revision: revision.updatedAt, started: now, token, generation: control.generation };
  }, transactionOptions);
}
type Claim = NonNullable<Awaited<ReturnType<typeof claim>>>;

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
    row.identityHash === matchHash &&
    row.connectionRevision?.getTime() === job.revision.getTime();
  let excluded = false;
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
        if (error instanceof AriveError && /^Arive API request returned HTTP (403|404)\b/.test(error.message)) {
          throw new PilotMatchReview(
            'The branch connection could not access this loan. Review Arive permissions and the loan ID.',
          );
        }
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
      if (matches.length !== 1 || typeof matches[0].sysGUID !== 'string')
        throw new PilotMatchReview('The branch connection did not return one exact loan.');
      guid = matches[0].sysGUID;
    }
    if (!guid || !/^[a-zA-Z0-9-]{1,100}$/.test(guid))
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
    const identity = inspectAriveLoanIdentity(details, loan, {
      ariveGuid: guid,
      verifiedOriginatorEmail: pinned?.verifiedOriginatorEmail,
    });
    if (identity.issues.length) throw new PilotMatchReview('Arive loan, borrower or originator did not match.');
    const trackers = await api(`${path}/trackers`);
    const notes = await readAriveNotes(guid, api);
    if (stableAriveValue(details) !== stableAriveValue(await api(path))) throw new Error('INCOMPLETE');
    const permanentGuid = guid;
    return await db.$transaction(async (tx) => {
      await lock(tx);
      await tx.$queryRaw`SELECT "id" FROM "AriveIntegrationConfig" WHERE "id"=${CONNECTION} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "ProcessingPipelineLoan" WHERE "id"=${row.pipelineId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id"=${loan.id} FOR SHARE`;
      const current = await tx.pilotAriveProjection.findUnique({
        where: { pipelineId: row.pipelineId },
        include: includeFile,
      });
      const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
      const credential = await tx.ariveIntegrationConfig.findUnique({
        where: { id: CONNECTION },
        select: { updatedAt: true },
      });
      const now = clock();
      if (
        !control?.enabled ||
        control.generation !== job.generation ||
        current?.leaseToken !== token ||
        !current.leaseUntil ||
        current.leaseUntil <= now ||
        current.projectionVersion !== row.projectionVersion ||
        credential?.updatedAt.getTime() !== job.revision.getTime() ||
        (!isEligible(current.pipeline, now) &&
          !row.manualRefreshRequestedAt &&
          jsonRecord(current.routingProvenance).kind !== 'ARCHIVE') ||
        pilotIdentityHash(current.pipeline.loan) !== matchHash ||
        !(await practiceEligibility(tx, current.pipeline, number, permanentGuid)).allowed
      ) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return 'held' as const;
      }
      const projected = leadershipPilotProjection({
        current: current.pipeline,
        loan: current.pipeline.loan,
        prior: validOld ? current : null,
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
          identityHash: matchHash,
          connectionRevision: job.revision,
          enrollmentStatus: 'VERIFIED',
          enrollmentIssue: null,
          collectedAt: now,
          sourceModifiedAt,
          lastError: null,
          failureCount: 0,
          leaseUntil: null,
          leaseToken: null,
          nextAttemptAt: new Date(+now + next),
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
    const message = review
      ? error.message
      : deferred
        ? `Arive collection deferred (${error.code}).`
        : 'Could not complete this Arive read.';
    const retry =
      deferred && error.retryAt && error.retryAt > now
        ? error.retryAt
        : new Date(+now + (review ? 24 * HOUR : Math.min(HOUR, 30_000 * 2 ** Math.min(row.failureCount, 6))));
    await db.$transaction(async (tx) => {
      await lock(tx);
      const control = await tx.pilotAriveControl.findUnique({ where: { id: CONNECTION } });
      if (!control?.enabled || control.generation !== job.generation) {
        await tx.pilotAriveProjection.updateMany({ where: owner, data: { leaseUntil: null, leaseToken: null } });
        return;
      }
      const changed = await tx.pilotAriveProjection.updateMany({
        where: owner,
        data: {
          ...(review ? { enrollmentStatus: excluded ? 'EXCLUDED' : 'REVIEW', enrollmentIssue: message } : {}),
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
  const deadlineMs = options.deadlineMs ?? Date.now() + 110_000;
  if (!allowedEnvironment() || Date.now() >= deadlineMs - 30_000) return { checked, succeeded, deferred };
  if (!options.pipelineId) {
    await discover(db, now());
    try {
      await collectPilotChangeHints(db, now(), options.session ?? ariveLeadershipPilotReadSession);
    } catch {
      /* An unavailable hint feed cannot suppress the fair reconciliation sweep. */
    }
  }
  while (Date.now() < deadlineMs - 30_000 && checked < 500) {
    const first = await claim(db, now(), options.pipelineId, true);
    if (!first) break;
    const second = options.pipelineId ? null : await claim(db, now(), undefined, false);
    const work = second ? [first, second] : [first];
    const results = await Promise.all(work.map((job) => collect(db, job, { ...options, deadlineMs })));
    checked += results.length;
    succeeded += results.filter((result) => result === 'verified').length;
    deferred += results.filter((result) => result === 'deferred').length;
    if (options.pipelineId || deferred) break;
  }
  return { checked, succeeded, deferred };
}
