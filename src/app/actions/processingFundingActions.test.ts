import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingPipelineSheet, ProcessingPipelineStatus, UserRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  session: vi.fn(), notify: vi.fn(), sync: vi.fn(),
  db: {
    user: { findUnique: vi.fn() },
    processingPipelineLoan: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
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
import { getProcessingFundingContext, moveProcessingPipelineLoan } from './processingPipelineActions';

const input = { id: 'pipeline', version: 1, sheet: ProcessingPipelineSheet.FUNDING, signingAt: '2026-10-09', rescissionApplies: true };
function current(purpose = 'Refinance') {
  return { id: 'pipeline', loanId: 'loan', sourceTaskId: 'task', version: 1,
    sheet: ProcessingPipelineSheet.PIPELINE, pipelineStatus: ProcessingPipelineStatus.DOCS_OUT,
    sourceTask: { submissionData: { loanPurpose: purpose } } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'processor', role: UserRole.PROCESSOR_SR, name: 'Processor' } });
  mocks.db.user.findUnique.mockResolvedValue({ processingAssignmentGroups: [] });
  mocks.db.$transaction.mockImplementation(async (callback) => callback(mocks.db));
  mocks.db.processingPipelineLoan.findFirst.mockResolvedValue(current());
  mocks.db.processingPipelineLoan.updateMany.mockResolvedValue({ count: 1 });
});

describe('processor funding dates', () => {
  it('saves holiday-adjusted funding and dependent payment dates, auditing the inputs', async () => {
    expect(await moveProcessingPipelineLoan(input)).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pipeline', version: 1 },
      data: expect.objectContaining({
        fundedAt: new Date('2026-10-15'), firstPaymentAt: new Date('2026-12-01T12:00:00Z'),
        sixthPaymentAt: new Date('2027-04-15'), pipelineStatus: ProcessingPipelineStatus.FUNDED,
      }),
    }));
    const details = JSON.parse(mocks.db.auditLog.create.mock.calls[0][0].data.details);
    expect(details).toMatchObject({ signingAt: '2026-10-09T00:00:00.000Z', rescissionDeadline: '2026-10-14T00:00:00.000Z', rescissionApplies: true });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ event: 'FUNDED' }));
  });

  it('detects a purchase on the server and skips rescission', async () => {
    mocks.db.processingPipelineLoan.findFirst.mockResolvedValue(current('Purchase'));
    expect(await getProcessingFundingContext('pipeline')).toMatchObject({ success: true, isPurchase: true });
    expect(await moveProcessingPipelineLoan(input)).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data.fundedAt).toEqual(new Date('2026-10-09'));
  });

  it('supports other loans without rescission', async () => {
    expect(await moveProcessingPipelineLoan({ ...input, rescissionApplies: false })).toMatchObject({ success: true });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data.fundedAt).toEqual(new Date('2026-10-09'));
  });

  it('recalculates payment months when a holiday pushes funding into the next month', async () => {
    await moveProcessingPipelineLoan({ ...input, signingAt: '2026-12-28' });
    expect(mocks.db.processingPipelineLoan.updateMany.mock.calls[0][0].data).toMatchObject({
      fundedAt: new Date('2027-01-04'), firstPaymentAt: new Date('2027-03-01T12:00:00Z'), sixthPaymentAt: new Date('2027-07-04'),
    });
  });

  it.each([
    { ...input, signingAt: '2026-02-30' },
    { ...input, rescissionApplies: undefined },
    { ...input, signingAt: undefined },
  ])('rejects invalid or incomplete funding inputs without writing', async (request) => {
    expect(await moveProcessingPipelineLoan(request)).toMatchObject({ success: false });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('retains stale-version protection', async () => {
    expect(await moveProcessingPipelineLoan({ ...input, version: 0 })).toMatchObject({ success: false, conflict: true });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });

  it('prevents processors from overwriting a previously funded loan', async () => {
    mocks.db.processingPipelineLoan.findFirst.mockResolvedValue({ ...current(), sheet: ProcessingPipelineSheet.FUNDING });
    expect(await moveProcessingPipelineLoan(input)).toMatchObject({ success: false, error: 'Funded loans are read-only.' });
    expect(mocks.db.processingPipelineLoan.updateMany).not.toHaveBeenCalled();
  });
});
