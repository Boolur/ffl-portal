import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingPipelineSheet, UserRole } from '@prisma/client';
import { pilotIdentityHash } from '../../lib/ariveLeadershipPilotIdentity';
import { ARIVE_SYNC_PILOT } from '../../lib/ariveSyncTypes';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), notify: vi.fn(), sync: vi.fn(), committed: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    processingPipelineLoan: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    arivePipelineSync: { findUnique: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    ariveRolloutControl: { findUnique: vi.fn() },
    pilotAriveRenderAck: { createMany: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    loan: { update: vi.fn() }, task: { update: vi.fn() }, leadUserTeam: { findMany: vi.fn() },
    $transaction: vi.fn(), $executeRaw: vi.fn(), $queryRaw: vi.fn(),
  },
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/processingPipeline', async () => import('../../lib/processingPipeline'));
vi.mock('@/lib/processingRouting', async () => import('../../lib/processingRouting'));
vi.mock('@/lib/processingBorrowerDetails', async () => import('../../lib/processingBorrowerDetails'));
vi.mock('@/lib/mortgageCalendar', async () => import('../../lib/mortgageCalendar'));
vi.mock('@/lib/leadPipelineSync', () => ({ syncLeadStatusForLoan: mocks.sync }));
vi.mock('@/lib/processingManagerNotifications', () => ({ notifyProcessingManagers: mocks.notify }));
import {
  declineProcessingPipelineLoan, dismissProcessingRateLockRequest, getProcessingBorrowerDetails,
  getProcessingPipeline, getProcessingAriveSnapshot, getProcessingAriveStageCounts, moveProcessingPipelineLoan, requestProcessingRateLock,
  acknowledgePilotRender,
  updateProcessingBorrowerDetails, updateProcessingPipelineCell, updateProcessingPipelineRateLock,
  updateProcessingRestructureWorkflow, type ProcessingBorrowerDetailsInput,
} from './processingPipelineActions';

const actualDate = new Date('2026-10-15T13:45:00.000Z');
function current(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pipeline', loanId: ARIVE_SYNC_PILOT.loanId, sourceTaskId: 'request', version: 1,
    sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: actualDate,
    dateAssigned: actualDate, updatedAt: actualDate, estimatedSigningAt: null,
    titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', payoffOrderedAt: null, payoffExpiresAt: null,
    hoiStatus: 'NOT_STARTED', hoiOrderedAt: null, appraisalNeeded: null, appraisalNotes: null,
    appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null,
    cdSent: false, cdWarningStartsAt: null, missingItemsCurrentStatus: null, extraNotes: null, restructureNotes: null,
    rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null,
    rateLockRequestedAt: actualDate, rateLockRequestedById: 'manager', approvedWithConditionsAt: null,
    loanType: null, propertyState: null, lender: null, leadSource: null, projectedRevenue: null, finalRevenue: null,
    fundedAt: null, firstPaymentAt: null, sixthPaymentAt: null, movedAt: null, archivedAt: null, archivedById: null,
    processingMethod: 'IN_HOUSE', assignmentGroup: 'MARTIN_SON_BUI', seniorProcessor: null, juniorProcessor: null,
    sourceTask: { id: 'request', title: 'Recovered test request', status: 'COMPLETED', createdAt: actualDate, completedAt: actualDate, submissionData: { loanPurpose: 'Refinance' }, attachments: [] },
    loan: { id: ARIVE_SYNC_PILOT.loanId, loanNumber: ARIVE_SYNC_PILOT.loanNumber, loanOfficerId: ARIVE_SYNC_PILOT.ownerId, borrowerName: 'TESTING TESTER', borrowerFirstName: 'TESTING', borrowerLastName: 'TESTER', borrowerPhone: null, borrowerEmail: null, propertyAddress: null, amount: 100000, program: null, loanOfficer: { id: ARIVE_SYNC_PILOT.ownerId, name: 'Matt', email: 'synthetic@example.test' }, secondaryLoanOfficer: null, payrollCompRequests: [] },
    ...overrides,
  };
}
function managedValues(row: ReturnType<typeof current>) {
  return Object.fromEntries(['sheet', 'pipelineStatus', 'statusChangedAt', 'titleStatus', 'payoffStatus', 'payoffOrderedAt', 'payoffExpiresAt', 'hoiStatus', 'hoiOrderedAt', 'appraisalNeeded', 'appraisalOrderedAt', 'appraisalScheduledAt', 'appraisalBackAt', 'cdSent', 'cdWarningStartsAt', 'missingItemsCurrentStatus', 'estimatedSigningAt', 'rateLock', 'rateLockExpiresAt', 'rateLockConfirmedAt', 'approvedWithConditionsAt', 'fundedAt'].map(field => {
    const value = (row as Record<string, unknown>)[field];
    return [field, value instanceof Date ? value.toISOString() : value];
  }));
}
function configureRow(row: ReturnType<typeof current>, enabled = true) {
  const state = {
    id: 'sync', pipelineId: row.id, enabled,
    snapshot: { source: { stage: 'APPLICATION_INTAKE', stageLabel: 'Application intake', stageDate: '2026-10-15' }, managed: managedValues(row), rawPrivateMarker: 'RAW_ARIVE_PAYLOAD_MUST_NOT_LEAK', structuredValues: {} },
    fieldSources: { hidden: { rawText: 'RAW_NOTE_MUST_NOT_LEAK' } }, issues: [], conflicts: [],
    lastSuccessAt: actualDate, lastAttemptAt: actualDate, nextAttemptAt: null, lastError: null,
  };
  mocks.db.processingPipelineLoan.findFirst.mockResolvedValue({ ...row, ariveSync: state });
  const gridRow = { ...row };
  delete (gridRow as Partial<typeof row>).sourceTask;
  mocks.db.processingPipelineLoan.findMany.mockResolvedValue([{ ...gridRow, ariveSync: state }]);
  mocks.db.arivePipelineSync.findUnique.mockResolvedValue(state);
  return state;
}
function detailsInput(overrides: Partial<ProcessingBorrowerDetailsInput> = {}): ProcessingBorrowerDetailsInput {
  return {
    id: 'pipeline', version: 1, borrowerFirstName: 'TESTING', borrowerLastName: 'TESTER', borrowerPhone: '', borrowerEmail: '',
    coBorrowerFirstName: '', coBorrowerLastName: '', coBorrowerPhone: '', coBorrowerEmail: '',
    propertyStreet: '', propertyUnit: '', propertyCity: '', propertyState: '', propertyZip: '', propertyOccupancy: '',
    estimatedValue: '', yearBuilt: '', yearAcquired: '', titleHeldAs: '', loanAmount: '100000', loanType: '', loanProgram: '', lender: '', channel: '', loanPurpose: 'Refinance', leadSource: '', cashBack: '', projectedRevenue: '',
    appraisalNeeded: null, appraisalWaiver: '', appraisalOrderedAt: '', appraisalScheduledAt: '', appraisalBackAt: '', appraisalNotes: '',
    sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', dateAssigned: '2026-10-15', estimatedSigningAt: '', titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', payoffExpiresAt: '', hoiStatus: 'NOT_STARTED',
    missingItemsCurrentStatus: '', extraNotes: 'Portal-only note', restructureNotes: '', rateLock: false, rateLockExpiresAt: '', cdSent: false, fundedAt: '', ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PILOT_VIEW_ENABLED', 'true'); vi.stubEnv('ARIVE_ROLLOUT_ENABLED', 'true');
  vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production');
  mocks.db.ariveRolloutControl.findUnique.mockResolvedValue({ collectionEnabled: true, applicationEnabled: true });
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: UserRole.ADMIN_III, name: 'Admin' } });
  mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.ADMIN_III, roles: [], processingAssignmentGroups: [], pilotViewEnabled: false });
  mocks.db.$transaction.mockImplementation(async work => {
    const result = typeof work === 'function' ? await work(mocks.db) : await Promise.all(work);
    mocks.committed(); return result;
  });
  mocks.db.$executeRaw.mockResolvedValue(0);
  mocks.db.processingPipelineLoan.updateMany.mockResolvedValue({ count: 1 });
  mocks.db.processingPipelineLoan.count.mockResolvedValue(1);
  mocks.db.user.findMany.mockResolvedValue([]); mocks.db.leadUserTeam.findMany.mockResolvedValue([]);
  mocks.db.auditLog.findMany.mockResolvedValue([]);
  configureRow(current());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('Arive authority in pipeline mutation actions', () => {
  it('records a conflicting cell edit in a committed transaction and retains the row', async () => {
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'titleStatus', value: 'RECEIVED' })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['titleStatus'] });
    expect(mocks.committed).toHaveBeenCalledOnce();
    expect(mocks.db.arivePipelineSync.update).toHaveBeenCalledOnce();
    expect(mocks.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PROCESSING_ARIVE_PORTAL_EDIT_CONFLICT' }) }));
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('does not inspect or write sync state before authentication and version checks', async () => {
    mocks.session.mockResolvedValue(null);
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'titleStatus', value: 'RECEIVED' })).toMatchObject({ success: false });
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: UserRole.ADMIN_III } });
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 0, field: 'titleStatus', value: 'RECEIVED' })).toMatchObject({ success: false, conflict: true });
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
    expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('treats an unchanged managed calendar date as a no-op without inventing timestamps', async () => {
    configureRow(current({ appraisalOrderedAt: actualDate }));
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'appraisalOrderedAt', value: '2026-10-15' })).toMatchObject({ success: true, version: 1 });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
  });
  it('preserves actual progress and request dates when a portal lender edit applies legacy defaults', async () => {
    const result = await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'lender', value: 'Figure' });
    expect(result).toMatchObject({ success: true });
    const data = mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ lender: 'Figure', titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', cdSent: false, rateLock: false, rateLockConfirmedAt: null, rateLockRequestedAt: actualDate, rateLockRequestedById: 'manager' });
    expect(result).toMatchObject({ patch: { titleStatus: 'NOT_STARTED', rateLock: false, rateLockConfirmedAt: null } });
  });
  it('checks supplied related dates without treating omitted dates as edits', async () => {
    configureRow(current({ payoffStatus: 'RECEIVED', payoffExpiresAt: actualDate }));
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'payoffStatus', value: 'RECEIVED' })).toMatchObject({ success: true, version: 1 });
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'payoffStatus', value: 'RECEIVED', payoffExpiresAt: null })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['payoffExpiresAt'] });
  });
  it('records a rate-lock conflict before requiring a made-up expiration date', async () => {
    expect(await updateProcessingPipelineRateLock({ id: 'pipeline', version: 1, rateLock: true })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['rateLock'] });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
  it('allows unchanged imported expired locks without resetting confirmation or fulfilling requests', async () => {
    configureRow(current({ rateLock: true, rateLockExpiresAt: actualDate, rateLockConfirmedAt: actualDate }));
    expect(await updateProcessingPipelineRateLock({ id: 'pipeline', version: 1, rateLock: true, expiresAt: '2026-10-15' })).toMatchObject({ success: true, version: 1, patch: { rateLockRequestedAt: actualDate.toISOString() } });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('keeps request and dismissal actions editable in the portal', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'processor', role: UserRole.PROCESSOR_JR } });
    mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.PROCESSOR_JR, roles: [], processingAssignmentGroups: [] });
    configureRow(current({ rateLockRequestedAt: null, rateLockRequestedById: null }));
    expect(await requestProcessingRateLock({ id: 'pipeline', version: 1 })).toMatchObject({ success: true });
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: UserRole.ADMIN_III } });
    mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.ADMIN_III, roles: [], processingAssignmentGroups: [] });
    configureRow(current());
    expect(await dismissProcessingRateLockRequest({ id: 'pipeline', version: 1 })).toMatchObject({ success: true });
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
  });
  it('records attempted restructure transitions without changing the managed stage', async () => {
    configureRow(current({ sheet: 'RESTRUCTURE', pipelineStatus: 'SUSPENDED_RESTRUCTURE' }));
    expect(await updateProcessingRestructureWorkflow({ id: 'pipeline', version: 1, action: 'SEND_TO_UNDERWRITING', notes: 'Portal-only request' })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['pipelineStatus'] });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
  it('blocks manual archiving even though archive timestamps are not copied into managed values', async () => {
    configureRow(current({ sheet: 'RESTRUCTURE', pipelineStatus: 'ADVERSE_PENDING' }));
    expect(await declineProcessingPipelineLoan({ id: 'pipeline', version: 1 })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['archivedAt'] });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
  it('blocks a manual funding move before calculating dates or writing financial routing', async () => {
    expect(await moveProcessingPipelineLoan({ id: 'pipeline', version: 1, sheet: ProcessingPipelineSheet.FUNDING })).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['sheet', 'pipelineStatus'] });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('leaves nonpilot workflow behavior unchanged', async () => {
    configureRow(current({ loanId: 'another-loan', pipelineStatus: 'SUBBED_TO_UW' }));
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 1, field: 'titleStatus', value: 'ORDERED' })).toMatchObject({ success: true, version: 2 });
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
    expect(mocks.db.processingPipelineLoan.updateMany).toHaveBeenCalledOnce();
  });
});

describe('Arive authority in the borrower workspace', () => {
  it('allows portal-only saves with the imported early-stage Pending Approval placeholder', async () => {
    expect(await updateProcessingBorrowerDetails(detailsInput())).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data).toMatchObject({ pipelineStatus: 'PENDING_APPROVAL', statusChangedAt: actualDate, extraNotes: 'Portal-only note', rateLockRequestedAt: actualDate, rateLockRequestedById: 'manager' });
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('does not require or invent absent Arive signing, payoff, or lock dates during unrelated saves', async () => {
    configureRow(current({ pipelineStatus: 'DOCS_OUT', payoffStatus: 'RECEIVED', rateLock: true, rateLockConfirmedAt: null }));
    expect(await updateProcessingBorrowerDetails(detailsInput({ pipelineStatus: 'DOCS_OUT', payoffStatus: 'RECEIVED', rateLock: true }))).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data).toMatchObject({ estimatedSigningAt: null, payoffExpiresAt: null, rateLockExpiresAt: null, rateLockConfirmedAt: null, payoffOrderedAt: null, statusChangedAt: actualDate });
  });
  it('compares full managed pending-item text before legacy form length limits', async () => {
    const pending = 'x'.repeat(3000);
    configureRow(current({ missingItemsCurrentStatus: pending }));
    expect(await updateProcessingBorrowerDetails(detailsInput({ missingItemsCurrentStatus: pending }))).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data.missingItemsCurrentStatus).toBe(pending);
  });
  it('preserves unchanged date-only inputs against imported time-bearing values', async () => {
    configureRow(current({ estimatedSigningAt: actualDate }));
    expect(await updateProcessingBorrowerDetails(detailsInput({ estimatedSigningAt: '2026-10-15' }))).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data.estimatedSigningAt).toEqual(actualDate);
  });
  it('blocks a conflicting whole-form save and commits only its conflict record', async () => {
    expect(await updateProcessingBorrowerDetails(detailsInput({ pipelineStatus: 'CTC', extraNotes: 'Do not save a partial form' }))).toMatchObject({ success: false, ariveConflict: true, blockedFields: ['pipelineStatus'] });
    expect(mocks.committed).toHaveBeenCalledOnce();
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.loan.update).not.toHaveBeenCalled();
    expect(mocks.db.task.update).not.toHaveBeenCalled();
  });
  it('retains required-date validation for ordinary portal-owned loans', async () => {
    configureRow(current({ loanId: 'another-loan', pipelineStatus: 'DOCS_OUT' }));
    expect(await updateProcessingBorrowerDetails(detailsInput({ pipelineStatus: 'DOCS_OUT' }))).toMatchObject({ success: false, error: 'Estimated signing is required for Docs Out.' });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
});

describe('isolated leadership projection', () => {
  function role(activeRole:UserRole = UserRole.ADMIN_III, enabled = true) {
    mocks.session.mockResolvedValue({ user:{id:'viewer',role:activeRole,activeRole} });
    mocks.db.user.findUnique.mockResolvedValue({active:true,role:UserRole.ADMIN_III,roles:[activeRole],processingAssignmentGroups:[],pilotViewEnabled:enabled});
  }
  function projection() {
    const source = current();
    const imported = {pipelineId:source.id,ariveLoanId:String(source.loan.loanNumber),ariveGuid:'verified-guid',identityHash:pilotIdentityHash(source.loan),
      enrollmentStatus:'VERIFIED', collectedAt:actualDate,sourceStage:'LOAN_FUNDED',projectionVersion:3,
      snapshot:{managed:{sheet:'FUNDING',pipelineStatus:'FUNDED',titleStatus:'RECEIVED',fundedAt:actualDate.toISOString(),finalRevenue:999},
        source:{stage:'LOAN_FUNDED',stageLabel:'Loan funded',stageDate:'2026-10-15'},
        application:{version:1,loan:{baseLoanAmount:250000,privateAccount:'DO_NOT_EXPOSE_APPLICATION'},financial:{estimatedCashToClose:12000}},
        canonicalLoan:{amount:'250000',loanOfficerId:'wrong-user'},privateMarker:'DO_NOT_EXPOSE_APPLICATION'},notes:[]};
    mocks.db.$queryRaw.mockResolvedValue([imported]);
    return imported;
  }
  it.each([UserRole.ADMIN_I,UserRole.ADMIN_II,UserRole.ADMIN_III,UserRole.MANAGER,UserRole.PROCESSING_MANAGER])('applies the verified projection before searching and paging for %s', async activeRole => {
    role(activeRole); projection();
    expect(await getProcessingPipeline()).toMatchObject({success:true,pilotMode:true,total:0,rows:[]});
    const filters = {ariveStages:['LOAN_FUNDED'],titleStatuses:['RECEIVED' as const],loanAmountMin:245000};
    const match = await getProcessingPipeline({sheet:'FUNDING',filters});
    expect(match).toMatchObject({success:true,pilotMode:true,canEdit:false,total:1,rows:[{canEdit:false,finalRevenue:null,sheet:'FUNDING',titleStatus:'RECEIVED',
      loan:{loanOfficerId:ARIVE_SYNC_PILOT.ownerId,amount:250000},ariveSync:{pilotPreview:true,stage:'LOAN_FUNDED',projectionVersion:3}}]});
    expect(await getProcessingAriveStageCounts({sheet:'FUNDING',filters})).toMatchObject({success:true,counts:[{value:'LOAN_FUNDED',count:1}]});
    const details = await getProcessingBorrowerDetails('pipeline');
    expect(details).toMatchObject({success:true,details:{canEdit:false,processing:{sheet:'FUNDING',pipelineStatus:'FUNDED'},ariveApplication:{loan:{baseLoanAmount:250000}}}});
    expect(JSON.stringify(match)+JSON.stringify(details)).not.toContain('DO_NOT_EXPOSE_APPLICATION');
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
  it('rejects production mutations before entering the transaction when a viewer submits a stale edit in Pilot', async () => {
    role(); projection();
    expect(await updateProcessingPipelineCell({id:'pipeline',version:1,field:'titleStatus',value:'ORDERED'})).toMatchObject({success:false});
    expect(await updateProcessingBorrowerDetails(detailsInput())).toMatchObject({success:false});
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it('records source latency only for a verified visible note on the current revision', async () => {
    role();
    const imported = projection();
    const createdAt = new Date(actualDate.getTime() - 10_000);
    const receipt = { id: 'pipeline', version: 3, noteId: 'reply', parentNoteId: 'original' };
    Object.assign(imported.snapshot, { noteChangeEvidence: [{ noteId: 'reply', parentNoteId: 'original', createdAt: createdAt.toISOString() }] });
    for (const invalid of [{ ...receipt, version: 2 }, { ...receipt, noteId: 'wrong' }, { ...receipt, parentNoteId: null }]) {
      expect(await acknowledgePilotRender('NOTES', [invalid])).toBe(true);
    }
    expect(mocks.db.pilotAriveRenderAck.createMany).not.toHaveBeenCalled();
    expect(await acknowledgePilotRender('NOTES', [receipt])).toBe(true);
    expect(mocks.db.pilotAriveRenderAck.createMany).toHaveBeenCalledWith({ skipDuplicates: true, data: [
      { pipelineId: 'pipeline', surface: 'NOTES', collectedAt: actualDate, sourceChangedAt: createdAt, projectionVersion: 3 },
    ] });
    expect(await acknowledgePilotRender('GRID', [receipt])).toBe(true);
    expect(mocks.db.pilotAriveRenderAck.createMany.mock.calls.at(-1)?.[0].data[0].sourceChangedAt).toBeNull();
    role(UserRole.PROCESSOR_JR);
    expect(await acknowledgePilotRender('NOTES', [receipt])).toBe(false);
  });
  it.each(['OWNER_CHANGED','NUMBER_CHANGED','ENROLLMENT_REVIEW','DISABLED','REVOKED','ROLE_SWITCH'] as const)('withholds the verified snapshot after %s',async reason=>{
    role(); const state=projection();
    if(reason==='OWNER_CHANGED') state.identityHash='mismatch';
    if(reason==='NUMBER_CHANGED') state.ariveLoanId='9999999';
    if(reason==='ENROLLMENT_REVIEW') state.enrollmentStatus='REVIEW';
    if(reason==='DISABLED'||reason==='REVOKED') mocks.db.user.findUnique.mockResolvedValue({active:reason!=='DISABLED',role:UserRole.LOAN_OFFICER,roles:[],processingAssignmentGroups:[],pilotViewEnabled:true});
    if(reason==='ROLE_SWITCH') role(UserRole.PROCESSOR_JR);
    expect(await getProcessingAriveSnapshot('pipeline')).toMatchObject({success:false});
    const details=await getProcessingBorrowerDetails('pipeline');
    if(details.success) expect(details.details).not.toHaveProperty('ariveApplication');
    if(reason==='DISABLED'||reason==='REVOKED') expect(mocks.db.processingPipelineLoan.findFirst).not.toHaveBeenCalled();
  });
  it.each([UserRole.ADMIN_III,UserRole.MANAGER,UserRole.PROCESSOR_JR,UserRole.PROCESSOR_SR,UserRole.LOAN_OFFICER])('leaves Standard reads and guards on BISU for %s even when the test loan has a projection',async activeRole=>{
    role(activeRole,false); projection(); vi.stubEnv('ARIVE_CANONICAL_APPLY_ENABLED','');
    expect(await getProcessingPipeline({filters:{ariveStages:['LOAN_FUNDED']}})).toMatchObject({success:true,rows:[{sheet:'PIPELINE',ariveSync:null,titleStatus:'NOT_STARTED'}]});
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({success:true,details:{ariveSync:null}});
    expect(await getProcessingAriveSnapshot('pipeline')).toMatchObject({success:false});
    expect(await getProcessingAriveStageCounts({sheet:'PIPELINE'})).toMatchObject({options:[],counts:[]});
    expect(mocks.db.$queryRaw).not.toHaveBeenCalled();
    if(activeRole===UserRole.LOAN_OFFICER) configureRow(current({processingMethod:'SELF_PROCESSED'}));
    expect(await updateProcessingPipelineCell({id:'pipeline',version:1,field:'titleStatus',value:'ORDERED'})).toMatchObject({success:true});
    expect(mocks.db.processingPipelineLoan.updateMany).toHaveBeenCalledOnce();
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
  });
});
