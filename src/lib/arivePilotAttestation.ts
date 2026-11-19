import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { ariveLeadershipPilotReadSession } from './ariveClient';
import { buildProcessingPipelineScopeWhere } from './processingPipeline';
import { pilotIdentitySelect } from './leadershipPilotReads';
import { corroboratedPilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { makePilotBorrowerAttestation } from './arivePilotBorrowerMatch';
import { pilotMiddleNameReview, type PilotReportedBorrower } from './arivePilotAttestationTypes';
import { priorPilotDiagnostics } from './ariveLeadershipPilotReview';
import { jsonRecord } from './ariveSyncState';

type Actor = Parameters<typeof buildProcessingPipelineScopeWhere>[0] & { canViewGeneralizedArive: boolean };
const select = { id: true, loanId: true, loan: { select: { ...pilotIdentitySelect, program: true } },
  ariveSync: {select:{ ariveGuid:true,ariveLoanId:true,enrollmentStatus:true }},
  pilotArive: { select: { ariveGuid:true, ariveLoanId: true, lastAttemptAt: true, enrollmentStatus: true, enrollmentIssue: true,
    borrowerAttestation: true, connectionRevision: true, identityHash: true, leaseUntil: true } } } as const;

export async function recordPilotBorrowerAttestation(actor: Actor, pipelineId: string, report: PilotReportedBorrower,
  confirmedBorrowerScreen: boolean, db = prisma, createSession = ariveLeadershipPilotReadSession) {
  if ((process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') ||
      actor.role !== 'ADMIN_III' || !actor.canViewGeneralizedArive || confirmedBorrowerScreen !== true ||
      typeof pipelineId !== 'string' || !pipelineId || pipelineId.length > 100 || !report ||
      !/^\d{1,15}$/.test(report.number) || [report.name, report.officerEmail, report.branch].some(
        value => typeof value !== 'string' || !value.trim() || value.length > 256)) return false;
  const where = { AND: [{ id: pipelineId }, buildProcessingPipelineScopeWhere(actor)] };
  const row = await db.processingPipelineLoan.findFirst({ where, select });
  const review = row?.pilotArive;
  if (!row || review?.enrollmentStatus !== 'REVIEW' || review.enrollmentIssue !== pilotMiddleNameReview ||
      review.borrowerAttestation || review.ariveLoanId !== report.number || row.loan.loanNumber !== report.number ||
      !review.lastAttemptAt || +review.lastAttemptAt < Date.now() - 24 * 3_600_000 ||
      review.identityHash !== corroboratedPilotIdentityHash(row.loan) || !review.connectionRevision) return false;
  const [config, initialControl] = await Promise.all([
    db.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { updatedAt: true } }),
    db.pilotAriveControl.findUnique({ where: { id: 'company' }, select: { enabled: true, generation: true } }),
  ]);
  if (!initialControl?.enabled || !config || +config.updatedAt !== +review.connectionRevision ||
      await db.loan.count({where: { loanNumber: report.number }}) !== 1) return false;
  const api = await createSession();
  const found = await api('/loans?searchField=DISPLAY_ID&searchValue=' + report.number + '&limit=100&offset=0');
  if (!Array.isArray(found.rows) || found.rows.length >= 100 || (found.count !== undefined && found.rows.length !== found.count)) return false;
  const exact = found.rows.map(jsonRecord).filter((r: Record<string, unknown>) => String(r.ariveLoanId) === report.number);
  const guid = exact.length === 1 ? exact[0].sysGUID : null;
  const contradictsPin = (source: typeof row) => !!source && (
    (source.pilotArive?.ariveLoanId === report.number && !!source.pilotArive.ariveGuid && source.pilotArive.ariveGuid !== guid) ||
    (source.ariveSync?.enrollmentStatus === 'VERIFIED' && source.ariveSync.ariveLoanId === report.number &&
      !!source.ariveSync.ariveGuid && source.ariveSync.ariveGuid !== guid));
  if (typeof guid !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(guid) || contradictsPin(row)) return false;
  if (await db.arivePracticeLoan.findFirst({ where: { OR: [{ ariveLoanId: report.number }, { ariveGuid: guid }] }, select: { ariveLoanId: true } })) return false;
  const details = await api('/loans/' + encodeURIComponent(guid));
  const now = new Date();
  const record = makePilotBorrowerAttestation(details, row.loan, { ariveGuid: guid },
    { pipelineId, revision: config.updatedAt }, report, actor.id, now);
  if (!record) return false;
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('arive-leadership-pilot'))`;
    const user = await tx.user.findFirst({ where: { id: actor.id, active: true, pilotViewEnabled: true,
      OR: [{role: 'ADMIN_III'}, {roles: {has: 'ADMIN_III'}}] }, select: { id: true } });
    const liveConfig = await tx.ariveIntegrationConfig.findUnique({ where: { id: 'company' }, select: { updatedAt: true } });
    const control = await tx.pilotAriveControl.findUnique({where: { id: 'company' }, select: {enabled: true, generation: true}});
    const current = await tx.processingPipelineLoan.findFirst({ where, select });
    const prior = current?.pilotArive;
    // The diagnostic is supporting history. Current evidence is obtained from the
    // new branch reads above and checked again by the worker before publication.
    const [diagnostic] = await priorPilotDiagnostics(tx, [pipelineId], config.updatedAt);
    if (!user || !control?.enabled || control.generation !== initialControl.generation || !liveConfig || +liveConfig.updatedAt !== +config.updatedAt ||
        !current || current.loanId !== row.loanId || contradictsPin(current) || !prior || prior.borrowerAttestation || prior.enrollmentStatus !== 'REVIEW' ||
        prior.enrollmentIssue !== pilotMiddleNameReview || prior.connectionRevision?.getTime() !== +config.updatedAt ||
        prior.lastAttemptAt?.getTime() !== +review.lastAttemptAt! || (prior.leaseUntil && prior.leaseUntil > now) ||
        corroboratedPilotIdentityHash(current.loan) !== review.identityHash ||
        diagnostic?.outcome !== 'IDENTITY_MISMATCH' || !diagnostic.borrowerOnly || diagnostic.loanId !== row.loanId || diagnostic.number !== report.number ||
        await tx.loan.count({where: {loanNumber: report.number}}) !== 1 ||
        await tx.arivePracticeLoan.findFirst({ where: { OR: [{ ariveLoanId: report.number }, { ariveGuid: guid }] }, select: { ariveLoanId: true } })) return false;
    await tx.pilotAriveProjection.update({ where: {pipelineId}, data: { borrowerAttestation: record,
      manualRefreshRequestedAt: now, nextAttemptAt: now } });
    await tx.pilotAriveControl.update({ where: { id: 'company' }, data: { revision: {increment: 1} } });
    return true;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
