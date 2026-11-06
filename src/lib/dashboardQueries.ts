import { UserRole } from '@prisma/client';
import { prisma } from './prisma';
import { withPerfMetric } from './perf';
import { dashboardRequestWhere, dashboardTaskWhere, summarizeDashboardGroups, type DashboardActor, type DashboardRequestCursor, type DashboardRequestPage } from './dashboardSummary';

export const DASHBOARD_REQUEST_PAGE_SIZE = 30;

export async function getRecentDashboardRequests(actor: DashboardActor, cursor?: DashboardRequestCursor | null): Promise<DashboardRequestPage> {
  if (actor.role !== UserRole.LOAN_OFFICER && actor.role !== UserRole.LOA) return { items: [], nextCursor: null };
  const rows = await prisma.task.findMany({
    where: dashboardRequestWhere(actor, cursor),
    select: { id: true, title: true, createdAt: true, loan: { select: { loanNumber: true, borrowerName: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: DASHBOARD_REQUEST_PAGE_SIZE + 1,
  });
  const items = rows.slice(0, DASHBOARD_REQUEST_PAGE_SIZE);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > DASHBOARD_REQUEST_PAGE_SIZE && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null };
}

export async function getDashboardSummary(actor: DashboardActor) {
  return withPerfMetric('query.dashboard.summary', async () => {
    if (new Set<UserRole>([UserRole.PROCESSOR_SR, UserRole.PROCESSING_MANAGER, UserRole.VA, UserRole.VA_TITLE, UserRole.VA_PAYOFF, UserRole.VA_APPRAISAL]).has(actor.role)) {
      return summarizeDashboardGroups([], actor);
    }
    const groups = await prisma.task.groupBy({
      by: ['kind', 'status', 'workflowState', 'assignedUserId'],
      where: dashboardTaskWhere(actor),
      _count: { _all: true },
    });
    return summarizeDashboardGroups(groups, actor);
  }, { role: actor.role });
}
