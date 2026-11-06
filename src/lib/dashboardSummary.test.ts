import { describe, expect, it } from 'vitest';
import { TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import { dashboardRequestWhere, dashboardTaskWhere, summarizeDashboardGroups, type DashboardTaskGroup } from './dashboardSummary';

const actor = { id: 'me', role: UserRole.ADMIN_III, name: 'Current user' };
// Exercise every enum combination so new statuses cannot accidentally become
// completed/active in the optimized counts. Compare to the pre-change UI rules.
const rows = Object.values(TaskKind).flatMap(kind => Object.values(TaskStatus).flatMap(status =>
  Object.values(TaskWorkflowState).flatMap(workflowState => [null, 'me', 'colleague'].map(assignedUserId =>
    ({ kind, status, workflowState, assignedUserId })))));
const groups: DashboardTaskGroup[] = rows.map(row => ({ ...row, _count: { _all: 3 } }));

describe('dashboard summary preserves the existing cards', () => {
  it.each([UserRole.ADMIN_III, UserRole.MANAGER, UserRole.PROCESSOR_JR])('matches the previous array counts for %s', role => {
    const summary = summarizeDashboardGroups(groups, { ...actor, role });
    const disclosure = rows.filter(row => row.kind === TaskKind.SUBMIT_DISCLOSURES);
    const processing = rows.filter(row => row.kind === TaskKind.SUBMIT_PROCESSING);
    const active = (row: typeof rows[number]) => row.status !== TaskStatus.COMPLETED;
    expect(summary.disclosure).toEqual({
      newCount: disclosure.filter(row => active(row) && row.workflowState === TaskWorkflowState.NONE).length * 3,
      startedCount: 0,
      waitingMissingCount: disclosure.filter(row => active(row) && row.workflowState === TaskWorkflowState.WAITING_ON_LO).length * 3,
      waitingApprovalCount: disclosure.filter(row => active(row) && row.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL).length * 3,
      loRespondedCount: disclosure.filter(row => active(row) && row.workflowState === TaskWorkflowState.READY_TO_COMPLETE).length * 3,
      completedCount: disclosure.filter(row => row.status === TaskStatus.COMPLETED).length * 3,
    });
    expect(summary.processing).toEqual({
      newCount: processing.filter(row => row.status === TaskStatus.PENDING && row.workflowState === TaskWorkflowState.NONE && !row.assignedUserId).length * 3,
      startedCount: processing.filter(row => active(row) && row.workflowState === TaskWorkflowState.NONE && row.assignedUserId && (role !== UserRole.PROCESSOR_JR || row.assignedUserId === actor.id)).length * 3,
      waitingMissingCount: processing.filter(row => active(row) && (row.workflowState === TaskWorkflowState.WAITING_ON_LO || row.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)).length * 3,
      waitingApprovalCount: 0,
      loRespondedCount: processing.filter(row => active(row) && row.workflowState === TaskWorkflowState.READY_TO_COMPLETE).length * 3,
      completedCount: processing.filter(row => row.status === TaskStatus.COMPLETED).length * 3,
    });
    expect(summary.requests).toEqual({
      total: (disclosure.length + processing.length) * 3,
      pendingCount: [...disclosure, ...processing].filter(row => row.status === TaskStatus.PENDING).length * 3,
      inProgressCount: [...disclosure, ...processing].filter(row => row.status === TaskStatus.IN_PROGRESS).length * 3,
      completedCount: [...disclosure, ...processing].filter(row => row.status === TaskStatus.COMPLETED).length * 3,
    });
  });
  it('never counts pilot document tasks as processing requests', () => {
    expect(summarizeDashboardGroups([{ kind: null, status: TaskStatus.PENDING, workflowState: TaskWorkflowState.NONE, assignedUserId: 'me', _count: { _all: 100 } }], actor).requests.total).toBe(0);
  });
});

describe('dashboard scoping and stable history cursor', () => {
  it('retains officer visibility plus the former primary-officer display filter', () => {
    const where = JSON.stringify(dashboardTaskWhere({ ...actor, role: UserRole.LOAN_OFFICER }));
    expect(where).toContain('secondaryLoanOfficerId');
    expect(where).toContain('visibilitySubmitterUserId');
    expect(where).toContain('Current user');
    expect(where).toContain('me');
  });
  it('keeps Jr waiting work personal and completed history shared', () => {
    expect(dashboardTaskWhere({ ...actor, role: UserRole.PROCESSOR_JR })).toEqual({ kind: TaskKind.SUBMIT_PROCESSING, OR: [
      { status: TaskStatus.PENDING, workflowState: TaskWorkflowState.NONE, assignedUserId: null },
      { status: { not: TaskStatus.COMPLETED }, assignedUserId: 'me' }, { status: TaskStatus.COMPLETED },
    ] });
  });
  it('denies missing identities and unused roles', () => {
    expect(dashboardTaskWhere({ ...actor, id: '' })).toEqual({ id: '__none__' });
    expect(dashboardTaskWhere({ ...actor, role: UserRole.ONBOARDING })).toEqual({ id: '__none__' });
  });
  it('retains scope on subsequent pages and breaks equal timestamps by ID', () => {
    const lo = { ...actor, role: UserRole.LOAN_OFFICER };
    const date = '2026-11-06T12:00:00.000Z';
    expect(dashboardRequestWhere(lo, { id: 'last', createdAt: date })).toEqual({ AND: [dashboardTaskWhere(lo), { OR: [
      { createdAt: { lt: new Date(date) } }, { createdAt: new Date(date), id: { lt: 'last' } },
    ] }] });
  });
  it('rejects a malformed cursor', () => {
    expect(() => dashboardRequestWhere(actor, { id: 'last', createdAt: 'invalid' })).toThrow('Invalid request cursor');
  });
});
