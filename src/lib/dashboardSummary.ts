import { Prisma, TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import { isAdmin } from './adminTiers';
import { buildLoanOfficerTaskWhere } from './loanOfficerVisibility';

export type DashboardActor = { id: string; role: UserRole; name?: string | null };
export type DeskSummary = {
  newCount: number;
  startedCount: number;
  waitingMissingCount: number;
  waitingApprovalCount: number;
  loRespondedCount: number;
  completedCount: number;
};
export type DashboardSummary = {
  disclosure: DeskSummary;
  processing: DeskSummary;
  requests: { pendingCount: number; inProgressCount: number; completedCount: number; total: number };
};
export type DashboardTaskGroup = {
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  assignedUserId: string | null;
  _count: { _all: number };
};
export type RecentDashboardRequest = {
  id: string;
  title: string;
  createdAt: Date;
  loan: { loanNumber: string; borrowerName: string };
};
export type DashboardRequestCursor = { id: string; createdAt: string };
export type DashboardRequestPage = {
  items: RecentDashboardRequest[];
  nextCursor: DashboardRequestCursor | null;
};

export function emptyDeskSummary(): DeskSummary {
  return { newCount: 0, startedCount: 0, waitingMissingCount: 0, waitingApprovalCount: 0, loRespondedCount: 0, completedCount: 0 };
}

// This is the intersection of the previous server scope and the dashboard's
// client-side filters. Keep secondary-LO visibility and the existing primary-LO
// dashboard rule unchanged; Tasks continues to use its wider visibility rule.
export function dashboardTaskWhere(actor: DashboardActor): Prisma.TaskWhereInput {
  if (!actor.id) return { id: '__none__' };
  const kinds = { kind: { in: [TaskKind.SUBMIT_DISCLOSURES, TaskKind.SUBMIT_PROCESSING] } };
  if (actor.role === UserRole.LOAN_OFFICER) {
    return { AND: [buildLoanOfficerTaskWhere(actor.id), kinds,
      ...(actor.name ? [{ loan: { loanOfficer: { name: actor.name } } }] : []),
    ] };
  }
  if (actor.role === UserRole.LOA || actor.role === UserRole.MANAGER || isAdmin(actor.role)) return kinds;
  if (actor.role === UserRole.PROCESSOR_JR) {
    return { kind: TaskKind.SUBMIT_PROCESSING, OR: [
      { status: TaskStatus.PENDING, workflowState: TaskWorkflowState.NONE, assignedUserId: null },
      { status: { not: TaskStatus.COMPLETED }, assignedUserId: actor.id },
      { status: TaskStatus.COMPLETED },
    ] };
  }
  if (actor.role === UserRole.DISCLOSURE_SPECIALIST || actor.role === UserRole.QC) {
    return { kind: actor.role === UserRole.DISCLOSURE_SPECIALIST ? TaskKind.SUBMIT_DISCLOSURES : TaskKind.SUBMIT_PROCESSING,
      OR: [{ assignedRole: actor.role }, { assignedUserId: actor.id }],
      ...(actor.role === UserRole.QC ? { assignedRole: actor.role } : {}),
    };
  }
  return { id: '__none__' };
}

export function summarizeDashboardGroups(groups: DashboardTaskGroup[], actor: DashboardActor): DashboardSummary {
  const summary: DashboardSummary = { disclosure: emptyDeskSummary(), processing: emptyDeskSummary(),
    requests: { pendingCount: 0, inProgressCount: 0, completedCount: 0, total: 0 } };
  for (const group of groups) {
    if (group.kind !== TaskKind.SUBMIT_DISCLOSURES && group.kind !== TaskKind.SUBMIT_PROCESSING) continue;
    const n = group._count._all;
    summary.requests.total += n;
    if (group.status === TaskStatus.PENDING) summary.requests.pendingCount += n;
    if (group.status === TaskStatus.IN_PROGRESS) summary.requests.inProgressCount += n;
    if (group.status === TaskStatus.COMPLETED) summary.requests.completedCount += n;
    const isDisclosure = group.kind === TaskKind.SUBMIT_DISCLOSURES;
    const desk = isDisclosure ? summary.disclosure : summary.processing;
    if (group.status === TaskStatus.COMPLETED) { desk.completedCount += n; continue; }
    if (group.workflowState === TaskWorkflowState.NONE) {
      if (isDisclosure || (group.status === TaskStatus.PENDING && !group.assignedUserId)) desk.newCount += n;
      if (!isDisclosure && group.assignedUserId && (actor.role !== UserRole.PROCESSOR_JR || group.assignedUserId === actor.id)) desk.startedCount += n;
    }
    if (group.workflowState === TaskWorkflowState.WAITING_ON_LO || (!isDisclosure && group.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)) desk.waitingMissingCount += n;
    if (isDisclosure && group.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) desk.waitingApprovalCount += n;
    if (group.workflowState === TaskWorkflowState.READY_TO_COMPLETE) desk.loRespondedCount += n;
  }
  return summary;
}

export function dashboardRequestWhere(actor: DashboardActor, cursor?: DashboardRequestCursor | null): Prisma.TaskWhereInput {
  const scope = dashboardTaskWhere(actor);
  if (!cursor) return scope;
  const createdAt = new Date(cursor.createdAt);
  if (!cursor.id || cursor.id.length > 100 || !Number.isFinite(createdAt.getTime())) throw new Error('Invalid request cursor');
  return { AND: [scope, { OR: [
    { createdAt: { lt: createdAt } },
    { createdAt, id: { lt: cursor.id } },
  ] }] };
}
