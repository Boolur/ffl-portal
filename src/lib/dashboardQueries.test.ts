import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
const db = vi.hoisted(() => ({ task: { groupBy: vi.fn(), findMany: vi.fn() } }));
vi.mock('./prisma', () => ({ prisma: db }));
vi.mock('./perf', () => ({ withPerfMetric: (_: string, fn: () => unknown) => fn() }));
import { getDashboardSummary, getRecentDashboardRequests } from './dashboardQueries';
const actor = { id: 'me', role: UserRole.LOA, name: 'Assistant' };
beforeEach(() => vi.resetAllMocks());

describe('bounded dashboard data', () => {
  it('uses only grouped counts for desk cards, never loads task records', async () => {
    db.task.groupBy.mockResolvedValue([]);
    expect((await getDashboardSummary({ ...actor, role: UserRole.ADMIN_III })).requests.total).toBe(0);
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
  it('skips task reads entirely for processing-only dashboards', async () => {
    await getDashboardSummary({ ...actor, role: UserRole.PROCESSOR_SR });
    await getRecentDashboardRequests({ ...actor, role: UserRole.PROCESSOR_SR });
    expect(db.task.groupBy).not.toHaveBeenCalled();
    expect(db.task.findMany).not.toHaveBeenCalled();
  });
  it('returns 30 recent records with a stable continuation instead of transferring the history', async () => {
    db.task.findMany.mockResolvedValue(Array.from({ length: 31 }, (_, i) => ({ id: `task-${i}`, createdAt: new Date('2026-11-06'), title: 'Request', loan: { borrowerName: 'Fixture', loanNumber: '123' } })));
    const result = await getRecentDashboardRequests(actor);
    expect(result.items).toHaveLength(30);
    expect(result.nextCursor?.id).toBe('task-29');
    expect(db.task.findMany.mock.calls[0][0].take).toBe(31);
    const selection = JSON.stringify(db.task.findMany.mock.calls[0][0].select);
    expect(selection).not.toContain('submissionData');
    expect(selection).not.toContain('attachments');
  });
  it('stops scrolling at the end of the real history', async () => {
    db.task.findMany.mockResolvedValue([]);
    expect((await getRecentDashboardRequests(actor)).nextCursor).toBeNull();
  });
});
