import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskKind, UserRole } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  task: { findMany: vi.fn(), count: vi.fn() },
  payrollCompRequest: { findMany: vi.fn(), count: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  pendingStpDisposition: { findMany: vi.fn() },
  raw: vi.fn(),
}));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ prisma: { ...mocks, $queryRaw: mocks.raw } }));
vi.mock('@/lib/adminTiers', () => ({ isAdmin: (role: string) => role.startsWith('ADMIN') }));
vi.mock('@/lib/pipelinePilot', () => ({ canAccessPipelinePortal: () => true }));
vi.mock('@/lib/loanOfficerVisibility', () => ({ buildLoanOfficerLoanOrClauses: (id: string) => [
  { loanOfficerId: id }, { secondaryLoanOfficerId: id }, { visibilitySubmitterUserId: id },
] }));
vi.mock('@/lib/pipelineSubmissionShortcuts', () => ({ derivePipelineSubmissionShortcuts: () => ({ disclosures: false, processing: false }) }));
import { getPipelineReport } from './pipelineReportingActions';

function task(id: string, loanId = id, submissionData: Record<string, unknown> = {}) {
  return {
    id, kind: TaskKind.SUBMIT_PLUS_ONE as TaskKind, title: '+1', status: 'PENDING', workflowState: 'NONE',
    createdAt: new Date('2025-01-01T12:00:00Z'), completedAt: null, submissionData,
    loan: {
      id: loanId, loanNumber: `LOAN-${loanId}`, borrowerName: `Borrower ${id}`, amount: 100_000,
      borrowerPhone: '555-1234', borrowerEmail: 'borrower@example.com', program: 'Conventional',
      propertyAddress: '123 Main St', stage: 'LEAD', createdAt: new Date('2025-01-01'), updatedAt: new Date('2025-01-01'),
      loanOfficerId: 'officer', secondaryLoanOfficerId: null,
      loanOfficer: { name: 'Officer' }, secondaryLoanOfficer: null,
    },
  };
}
type FixtureTask = ReturnType<typeof task>;
type ReadQuery = {
  select: Record<string, unknown>;
  where?: {
    id?: { in: string[] }; kind?: unknown;
    OR?: Array<{ loanId?: { in: string[] }; loan?: { loanNumber: { in: string[] } } }>;
  };
  take?: number;
};
let candidates: FixtureTask[];
let period: FixtureTask[];
let processed: FixtureTask[];
const loanNumberKeys = ['arriveLoanNumber', 'ariveLoanNumber', 'arriveNumber', 'ariveNumber', 'loanNumber'];

beforeEach(() => {
  vi.clearAllMocks();
  candidates = [];
  period = [];
  processed = [];
  mocks.session.mockResolvedValue({ user: { id: 'officer', role: UserRole.LOAN_OFFICER, name: 'Officer' } });
  mocks.user.findMany.mockResolvedValue([{ id: 'officer', name: 'Officer', email: 'officer@example.com' }]);
  mocks.user.findUnique.mockResolvedValue({ loDisclosureSubmissionEnabled: true, loQcSubmissionEnabled: true });
  mocks.task.count.mockResolvedValue(0);
  mocks.payrollCompRequest.count.mockResolvedValue(0);
  mocks.payrollCompRequest.findMany.mockResolvedValue([]);
  mocks.pendingStpDisposition.findMany.mockResolvedValue([]);
  mocks.task.findMany.mockImplementation(async (query: ReadQuery) => {
    if (query.select.submissionData) {
      return query.where?.id ? candidates.filter(row => query.where!.id!.in.includes(row.id)) : period;
    }
    if (query.where?.kind === TaskKind.SUBMIT_PLUS_ONE) {
      const rows = candidates.map(row => ({ id: row.id, loan: { id: row.loan.id, loanNumber: row.loan.loanNumber } }));
      return query.take ? rows.slice(0, query.take) : rows;
    }
    if (query.select.id && query.select.loanId) {
      const ids = query.where?.OR?.flatMap(clause => clause.loanId?.in || []) || [];
      const numbers = query.where?.OR?.flatMap(clause => clause.loan?.loanNumber.in || []) || [];
      return processed.filter(row => ids.includes(row.loan.id) || numbers.includes(row.loan.loanNumber))
        .map(row => ({ id: row.id, loanId: row.loan.id, loan: { loanNumber: row.loan.loanNumber } }));
    }
    return [];
  });
  mocks.raw.mockImplementation(async (query: { sql: string; values: string[] }) => {
    expect(query.sql).toContain('jsonb_build_object');
    expect(query.sql).not.toContain('notesHistory');
    return [...candidates, ...processed].filter(row => query.values.includes(row.id)).map(row => ({
      id: row.id,
      submissionData: Object.fromEntries(loanNumberKeys.map(key => [key, row.submissionData[key] ?? null])),
    }));
  });
});

const filters = { preset: 'custom' as const, startDate: '2026-11-01', endDate: '2026-11-06' };

describe('pipeline report historical query slimming', () => {
  it('preserves all-time pending rows and their full notes while hydrating only unresolved history', async () => {
    candidates = [
      task('old-pending', 'pending', { ariveLoanNumber: 'A-1', notesHistory: [{ author: 'Officer', message: 'Original note', date: '2025-01-01T00:00:00Z' }] }),
      task('old-processed', 'processed'),
      task('old-actioned', 'actioned'),
    ];
    processed = [{ ...task('processing', 'processed'), kind: TaskKind.SUBMIT_PROCESSING }];
    mocks.pendingStpDisposition.findMany.mockResolvedValue([{ plusOneTaskId: 'old-actioned' }]);
    const report = await getPipelineReport(filters);
    expect(report.totals.pendingStp).toBe(1);
    expect(report.bucketRows.pendingStp[0].id).toBe('old-pending');
    expect(report.bucketRows.pendingStp[0].fileDetails.task?.notes[0].message).toBe('Original note');
    expect(report.boardMetrics.pendingStp).toEqual({ volumeTotal: 100_000, units: 1 });
    const reads = mocks.task.findMany.mock.calls.map(([query]) => query as ReadQuery);
    const historical = reads.find(query => query.where?.kind === TaskKind.SUBMIT_PLUS_ONE)!;
    expect(historical.take).toBeUndefined();
    expect(historical.select.submissionData).toBeUndefined();
    expect(historical.where).toMatchObject({ loan: { OR: [
      { loanOfficerId: 'officer' }, { secondaryLoanOfficerId: 'officer' }, { visibilitySubmitterUserId: 'officer' },
    ] } });
    const hydration = reads.filter(query => query.select.submissionData && query.where?.id);
    expect(hydration).toHaveLength(1);
    expect(hydration[0].where?.id?.in).toEqual(['old-pending']);
  });

  it('preserves legacy alias priority and processing matching across different loan records', async () => {
    candidates = [
      task('legacy', 'first', { arriveLoanNumber: null, ariveLoanNumber: ' A 123 ' }),
      task('type-priority', 'second', { arriveLoanNumber: 123, ariveLoanNumber: 'A123' }),
    ];
    processed = [{ ...task('processing', 'third', { arriveNumber: 'A123' }), kind: TaskKind.SUBMIT_QC }];
    processed[0].loan.loanNumber = 'LOAN-first';
    const report = await getPipelineReport(filters);
    expect(report.bucketRows.pendingStp.map(row => row.id)).toEqual(['type-priority']);
    expect(report.totals.pendingStp).toBe(1);
  });

  it('reuses full selected-period records instead of fetching them again', async () => {
    candidates = [task('current')];
    period = candidates;
    const report = await getPipelineReport(filters);
    expect(report.totals.pendingStp).toBe(1);
    expect(mocks.task.findMany.mock.calls.some(([query]) => query.select.submissionData && query.where?.id)).toBe(false);
  });

  it('keeps a pending record beyond the previous 10,000-row history limit', async () => {
    candidates = Array.from({ length: 10_001 }, (_, index) => task(`old-${index}`));
    mocks.pendingStpDisposition.findMany.mockResolvedValue(candidates.slice(0, 10_000).map(row => ({ plusOneTaskId: row.id })));
    const report = await getPipelineReport(filters);
    expect(report.totals.pendingStp).toBe(1);
    expect(report.bucketRows.pendingStp[0].id).toBe('old-10000');
  });
});
