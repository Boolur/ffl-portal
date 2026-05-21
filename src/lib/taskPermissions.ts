import { TaskKind, UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

const TASK_DELETE_ROLES = new Set<UserRole>([
  UserRole.MANAGER,
  UserRole.VA_TITLE,
  UserRole.VA_PAYOFF,
  UserRole.VA_APPRAISAL,
]);

export function canDeleteTasks(role?: UserRole | null): boolean {
  return Boolean(role && (isAdmin(role) || TASK_DELETE_ROLES.has(role)));
}

export function canDeleteTask(
  role: UserRole | null | undefined,
  task: { kind: TaskKind | null; assignedRole: UserRole | null },
): boolean {
  if (!role) return false;
  if (isAdmin(role) || role === UserRole.MANAGER) return true;
  if (role === UserRole.VA_TITLE) {
    return task.kind === TaskKind.VA_TITLE || task.assignedRole === UserRole.VA_TITLE;
  }
  if (role === UserRole.VA_PAYOFF) {
    return task.kind === TaskKind.VA_PAYOFF || task.assignedRole === UserRole.VA_PAYOFF;
  }
  if (role === UserRole.VA_APPRAISAL) {
    return task.kind === TaskKind.VA_APPRAISAL || task.assignedRole === UserRole.VA_APPRAISAL;
  }
  return false;
}
