import type { Prisma, UserRole } from '@prisma/client';

/** The Pilot switch follows the role currently in use, including on multi-role accounts. */
export function isPilotLeadershipRole(role: unknown): boolean {
  return role === 'ADMIN_I' || role === 'ADMIN_II' || role === 'ADMIN_III'
    || role === 'MANAGER' || role === 'PROCESSING_MANAGER';
}

type DeskActor = { id: string; role: UserRole };
type RequestScopeFields = { assignedRole?: string | null; assignedUserId?: string | null; assignedUser?: { id?: string; name?: string } | null; submissionData: unknown };
export function canAccessLeadershipRequest(actor: DeskActor, task: RequestScopeFields) {
  if (!isPilotLeadershipRole(actor.role)) return false;
  if (actor.role !== 'PROCESSING_MANAGER') return true;
  const data = task.submissionData as Record<string, unknown> | null;
  return task.assignedRole === actor.role || task.assignedUserId === actor.id || task.assignedUser?.id === actor.id ||
    (data?.leadershipPilotTest === true && data.leadershipTestSubmitterId === actor.id);
}

export function standardSharedTestData(data: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.leadershipPilotTest !== true) return data;
  const clean = { ...data };
  delete clean.processingDocumentTaskId;
  delete clean.leadershipPilotTest;
  delete clean.leadershipTestSubmitterId;
  return clean;
}

export function leadershipRequestScope(actor: DeskActor): Prisma.TaskWhereInput {
  if (!isPilotLeadershipRole(actor.role)) return { id: { in: [] } };
  if (actor.role !== 'PROCESSING_MANAGER') return {};
  return { OR: [
    { assignedRole: actor.role }, { assignedUserId: actor.id },
    { AND: [{ submissionData: { path: ['leadershipPilotTest'], equals: true } }, { submissionData: { path: ['leadershipTestSubmitterId'], equals: actor.id } }] },
  ] };
}

export function leadershipLoanScope(actor: DeskActor): Prisma.LoanWhereInput {
  if (!isPilotLeadershipRole(actor.role)) return { id: { in: [] } };
  if (actor.role !== 'PROCESSING_MANAGER') return {};
  return { OR: [
    { processingPipeline: { is: { archivedAt: null } } },
    { tasks: { some: leadershipRequestScope(actor) } },
  ] };
}

export function leadershipOfficerScope(actor: DeskActor): Prisma.UserWhereInput {
  const officer: Prisma.UserWhereInput = { active: true, OR: [{ role: 'LOAN_OFFICER' }, { roles: { has: 'LOAN_OFFICER' } }] };
  if (!isPilotLeadershipRole(actor.role)) return { id: { in: [] } };
  if (actor.role !== 'PROCESSING_MANAGER') return officer;
  const visibleLoans = leadershipLoanScope(actor);
  return { AND: [officer, { OR: [
    { loansAsLO: { some: visibleLoans } }, { loansAsSecondaryLO: { some: visibleLoans } },
  ] }] };
}
