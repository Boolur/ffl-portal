import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingPipelineSheet, UserRole } from '@prisma/client';
import { ARIVE_SYNC_PILOT } from '../../lib/ariveSyncTypes';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), notify: vi.fn(), sync: vi.fn(), committed: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    processingPipelineLoan: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    arivePipelineSync: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn(), findMany: vi.fn() },
    loan: { update: vi.fn() }, task: { update: vi.fn() }, leadUserTeam: { findMany: vi.fn() },
    $transaction: vi.fn(), $executeRaw: vi.fn(),
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
  getProcessingPipeline, moveProcessingPipelineLoan, requestProcessingRateLock,
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
  mocks.session.mockResolvedValue({ user: { id: 'admin', role: UserRole.ADMIN_III, name: 'Admin' } });
  mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.ADMIN_III, roles: [], processingAssignmentGroups: [] });
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
afterEach(() => vi.useRealTimers());

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
    expect(mocks.db.arivePipelineSync.findUnique).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ user: { id: 'admin', role: UserRole.ADMIN_III } });
    expect(await updateProcessingPipelineCell({ id: 'pipeline', version: 0, field: 'titleStatus', value: 'RECEIVED' })).toMatchObject({ success: false, conflict: true });
    expect(mocks.db.arivePipelineSync.findUnique).not.toHaveBeenCalled();
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
    expect(mocks.db.arivePipelineSync.findUnique).not.toHaveBeenCalled();
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

describe('sanitized Arive metadata', () => {
  it('returns only the allowlisted application projection for the exact authorized pilot', async () => {
    const state = configureRow(current());
    Object.assign(state.snapshot, { application: { version: 1, loan: { baseLoanAmount: 250000, privateAccount: 'DO_NOT_EXPOSE_APPLICATION' }, financial: { estimatedCashToClose: 12000 }, ssn: 'DO_NOT_EXPOSE_APPLICATION' } });
    const result = await getProcessingBorrowerDetails('pipeline');
    expect(result).toMatchObject({ success: true, details: { ariveApplication: { syncedAt: actualDate.toISOString(), loan: { baseLoanAmount: 250000 }, financial: { estimatedCashToClose: 12000 } } } });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_EXPOSE_APPLICATION');
    for (const override of [{ loanNumber: '999999' }, { loanOfficerId: 'another-owner' }, { id: 'another-loan' }, { borrowerName: 'Different borrower' }]) {
      const other = configureRow(current({ loan: { ...current().loan, ...override } }));
      Object.assign(other.snapshot, { application: { version: 1, financial: { estimatedCashToClose: 12000 } } });
      const unrelated = await getProcessingBorrowerDetails('pipeline');
      if (unrelated.success) expect(unrelated.details).not.toHaveProperty('ariveApplication');
    }
  });
  it('keeps application reads behind the existing authenticated row lookup', async () => {
    mocks.session.mockResolvedValue(null);
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ success: false });
    expect(mocks.db.processingPipelineLoan.findFirst).not.toHaveBeenCalled();
  });
  it.each([
    { sheet: 'FUNDING', pipelineStatus: 'FUNDED', stage: 'APPLICATION_INTAKE' },
    { sheet: 'PIPELINE', pipelineStatus: 'PENDING_APPROVAL', stage: 'UNRECOGNIZED_ARIVE_STAGE' },
  ])('uses the displayed Arive stage age without changing retained portal routing ($stage)', async ({ sheet, pipelineStatus, stage }) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T13:45:00Z'));
    const state = configureRow(current({ sheet, pipelineStatus }));
    state.snapshot.source.stage = stage;
    state.snapshot.source.stageDate = '2026-11-28T13:45:00Z';
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ daysInStatus: 2, statusChangedAt: actualDate.toISOString(), sheet, pipelineStatus }] });
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ details: { processing: { daysInStatus: 2, statusChangedAt: actualDate.toISOString(), sheet, pipelineStatus } } });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.db.arivePipelineSync.update).not.toHaveBeenCalled();
    expect(mocks.db.auditLog.create).not.toHaveBeenCalled();
  });
  it('returns to the legacy portal stage age when synchronization is paused', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T13:45:00Z'));
    const state = configureRow(current(), false);
    state.snapshot.source.stageDate = '2026-11-28T13:45:00Z';
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ daysInStatus: 46 }] });
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ details: { processing: { daysInStatus: 46 } } });
  });
  it('does not use an invalid source date or a different loan’s source date', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-30T13:45:00Z'));
    const invalid = configureRow(current());
    invalid.snapshot.source.stageDate = '2026-02-30';
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ daysInStatus: 46 }] });
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ details: { processing: { daysInStatus: 46 } } });
    const unrelated = configureRow(current({ loan: { ...current().loan, loanNumber: '999999' } }));
    unrelated.snapshot.source.stageDate = '2026-11-28T13:45:00Z';
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ daysInStatus: 46 }] });
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ details: { processing: { daysInStatus: 46 } } });
  });
  it('returns only the view model for pipeline rows and borrower details', async () => {
    const rows = await getProcessingPipeline();
    const details = await getProcessingBorrowerDetails('pipeline');
    expect(rows).toMatchObject({ success: true, rows: [{ ariveSync: { enabled: true, canManage: true, stage: 'APPLICATION_INTAKE' } }] });
    expect(details).toMatchObject({ success: true, details: { ariveSync: { enabled: true, canManage: true } } });
    for (const result of [rows, details]) {
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('RAW_ARIVE_PAYLOAD_MUST_NOT_LEAK');
      expect(serialized).not.toContain('RAW_NOTE_MUST_NOT_LEAK');
      expect(serialized).not.toContain('fieldSources');
    }
  });
  it('does not expose sync metadata for a different owner or loan number', async () => {
    configureRow(current({ loan: { ...current().loan, loanNumber: '999999' } }));
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ ariveSync: null }] });
    expect(await getProcessingBorrowerDetails('pipeline')).toMatchObject({ details: { ariveSync: null } });
  });
  it('only marks fresh active Admin III role membership as eligible to manage sync', async () => {
    mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.LOAN_OFFICER, roles: [], processingAssignmentGroups: [] });
    expect(await getProcessingPipeline()).toMatchObject({ rows: [{ ariveSync: { canManage: false } }] });
  });
});
