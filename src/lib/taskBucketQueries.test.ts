import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ prisma: db }));
vi.mock('@/lib/adminTiers', () => ({ isAdmin: (role: string) => role.startsWith('ADMIN') }));
vi.mock('@/lib/loanOfficerVisibility', () => ({ buildLoanOfficerTaskWhere: (id: string) => ({ loan: { loanOfficerId: id } }) }));
vi.mock('@/lib/processingRouting', () => ({ normalizeProcessingAssignmentGroups: (groups: string[]) => groups }));
vi.mock('@/lib/concurrencyLimit', () => ({
  ConcurrencyKeys: { taskBucketQueries: 'task-bucket-queries' },
  withConcurrencyLimit: (_key: string, _limit: number, work: () => Promise<unknown>) => work(),
}));

import { queryInitialTaskBucketsForRole, queryTaskBucketPage } from './taskBucketQueries';

beforeEach(() => {
  vi.clearAllMocks();
  db.task.findMany.mockResolvedValue([]);
  db.task.count.mockResolvedValue(42);
  db.user.findUnique.mockResolvedValue({ processingAssignmentGroups: [] });
  db.$queryRaw.mockResolvedValue([]);
});

describe('initial task queues', () => {
  it.each([UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III, UserRole.LOAN_OFFICER, UserRole.LOA])(
    'loads exact initial totals with the newest-update ordering for %s', async role => {
      const initial = await queryInitialTaskBucketsForRole(role, 'current-user');
      const buckets = [...initial.disclosureBuckets, ...initial.qcBuckets];
      expect(buckets).toHaveLength(role.startsWith('ADMIN') ? 10 : 8);
      expect(buckets.every(bucket => bucket.serverSort === 'updated_desc')).toBe(true);
      expect(db.task.findMany.mock.calls.every(([query]) => query.orderBy[0].updatedAt === 'desc')).toBe(true);
      expect(db.task.count).toHaveBeenCalledTimes(buckets.length);
      expect(buckets.every(bucket => bucket.totalCount === 42 && bucket.totalCountIsExact)).toBe(true);
      expect(initial.totalCount).toBe(42 * buckets.length);
      expect(initial.totalCountIsExact).toBe(true);
      expect(db.task.findMany.mock.calls.every(([query]) => query.take === 7)).toBe(true);
    }
  );

  it.each([UserRole.MANAGER, UserRole.PROCESSOR_JR])('keeps the Started queue oldest-first for %s', async role => {
    const initial = await queryInitialTaskBucketsForRole(role, 'current-user');
    expect(initial.qcBuckets.find(bucket => bucket.id === 'qc-started')?.serverSort).toBe('created_asc');
    expect(initial.qcBuckets.find(bucket => bucket.isCompleted)?.serverSort).toBe('updated_desc');
  });

  it('shows the full completed totals while returning only six cards per queue', async () => {
    const totals = [0, 1, 0, 1, 1584, 1, 1, 4, 1, 1583];
    for (const total of totals) {
      db.task.count.mockResolvedValueOnce(total);
      db.task.findMany.mockResolvedValueOnce(Array.from({ length: Math.min(total, 7) }, (_, index) => ({
        id: `card-${index}`, priority: 'NORMAL', parentTaskId: null, attachments: [],
      })));
    }
    const initial = await queryInitialTaskBucketsForRole(UserRole.ADMIN_III, 'admin');
    const disclosure = initial.disclosureBuckets.find(bucket => bucket.id === 'completed-disclosure')!;
    const processing = initial.qcBuckets.find(bucket => bucket.id === 'qc-completed-requests')!;
    expect(disclosure.tasks).toHaveLength(6);
    expect(disclosure.totalCount).toBe(1584);
    expect(disclosure.totalCountIsExact).toBe(true);
    expect(disclosure.nextCursor).not.toBeNull();
    expect(processing.tasks).toHaveLength(6);
    expect(processing.totalCount).toBe(1583);
    expect(processing.totalCountIsExact).toBe(true);
    expect(processing.nextCursor).not.toBeNull();
    expect(initial.totalCount).toBe(totals.reduce((sum, count) => sum + count, 0));
    expect(initial.totalCountIsExact).toBe(true);
  });

  it('does not issue an exact count for an append page', async () => {
    await queryTaskBucketPage({ role: UserRole.MANAGER, bucketId: 'new-disclosure', cursor: { id: 'last-card' }, includeTotalCount: false });
    expect(db.task.count).not.toHaveBeenCalled();
    expect(db.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7, cursor: { id: 'last-card' }, skip: 1 }));
  });

  it('still computes the exact count on replacement/search reads', async () => {
    const result = await queryTaskBucketPage({ role: UserRole.MANAGER, bucketId: 'new-disclosure', globalSearch: 'smith' });
    expect(db.task.count).toHaveBeenCalledTimes(1);
    expect(result.totalCount).toBe(42);
    expect(result.totalCountIsExact).toBe(true);
  });
});
