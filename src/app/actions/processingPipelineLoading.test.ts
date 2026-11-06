import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    leadUserTeam: { findMany: vi.fn() },
    processingPipelineLoan: { findMany: vi.fn() },
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
vi.mock('@/lib/leadPipelineSync', () => ({ syncLeadStatusForLoan: vi.fn() }));
vi.mock('@/lib/processingManagerNotifications', () => ({ notifyProcessingManagers: vi.fn() }));
import { getProcessingPipeline, getProcessingPipelineMetadata, getProcessingPipelineRows } from './processingPipelineActions';

function row(id: string) {
  return { id, dateAssigned: new Date('2026-10-01'), statusChangedAt: new Date('2026-10-02'), updatedAt: new Date('2026-10-03'),
    projectedRevenue: null, finalRevenue: null, processingMethod: 'Self Processed',
    loan: { id: `loan-${id}`, loanNumber: id, loanOfficerId: 'actor', borrowerName: 'Example Borrower', amount: 10, payrollCompRequests: [], loanOfficer: { id: 'actor', name: 'Officer' } } };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'actor', role: UserRole.LOAN_OFFICER, name: 'Officer' } });
  mocks.db.user.findUnique.mockResolvedValue({ active: true, role: UserRole.LOAN_OFFICER, roles: [], processingAssignmentGroups: [] });
  mocks.db.leadUserTeam.findMany.mockResolvedValue([]);
  mocks.db.user.findMany.mockResolvedValue([]);
});

describe('bounded processing pipeline reads', () => {
  it('filters and orders the entire manifest, hydrates only 100 rows, and keeps every remaining ID', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `p-${i}`);
    mocks.db.processingPipelineLoan.findMany
      .mockResolvedValueOnce(ids.map((id) => ({ id })))
      .mockResolvedValueOnce(ids.slice(0, 100).reverse().map(row));
    const result = await getProcessingPipeline({ search: 'Example', allSheets: true, sortBy: 'borrowerName', sortDirection: 'asc', filters: { lenders: ['Lender'] } });
    expect(result).toMatchObject({ success: true, total: 250, remainingIds: ids.slice(100) });
    if (result.success) expect(result.rows.map((item) => item.id)).toEqual(ids.slice(0, 100));
    const [manifest, detail] = mocks.db.processingPipelineLoan.findMany.mock.calls.map(([query]) => query);
    expect(manifest.select).toEqual({ id: true });
    expect(manifest.take).toBeUndefined();
    expect(manifest.orderBy).toEqual([{ loan: { borrowerName: 'asc' } }, { id: 'asc' }]);
    expect(JSON.stringify(manifest.where)).toContain('Example');
    expect(JSON.stringify(manifest.where)).toContain('Lender');
    expect(detail.where.AND[1]).toEqual({ id: { in: ids.slice(0, 100) } });
    expect(mocks.db.leadUserTeam.findMany).not.toHaveBeenCalled();
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
  });

  it('reauthorizes supplied continuation IDs and preserves scope even when IDs are forged', async () => {
    mocks.db.processingPipelineLoan.findMany.mockResolvedValue([]);
    expect(await getProcessingPipelineRows({ ids: ['foreign-loan'], viewScope: 'GLOBAL' })).toEqual({ success: true, rows: [] });
    const query = mocks.db.processingPipelineLoan.findMany.mock.calls[0][0];
    expect(query.where.AND[1]).toEqual({ id: { in: ['foreign-loan'] } });
    expect(JSON.stringify(query.where.AND[0])).toContain('actor');
    expect(JSON.stringify(query.where.AND[0])).toContain('archivedAt');
  });

  it('rejects unauthenticated and oversized continuation requests before reading rows', async () => {
    expect(await getProcessingPipelineRows({ ids: Array.from({ length: 101 }, (_, i) => String(i)) })).toMatchObject({ success: false });
    mocks.session.mockResolvedValue(null);
    expect(await getProcessingPipelineRows({ ids: ['p'] })).toMatchObject({ success: false });
    expect(mocks.db.processingPipelineLoan.findMany).not.toHaveBeenCalled();
  });

  it('loads reference data separately and skips processor directories for loan officers', async () => {
    expect(await getProcessingPipelineMetadata()).toMatchObject({ success: true, teams: [], juniorProcessorOptions: [], seniorProcessorOptions: [] });
    expect(mocks.db.leadUserTeam.findMany).toHaveBeenCalledOnce();
    expect(mocks.db.user.findMany).not.toHaveBeenCalled();
    expect(mocks.db.processingPipelineLoan.findMany).not.toHaveBeenCalled();
  });
});
