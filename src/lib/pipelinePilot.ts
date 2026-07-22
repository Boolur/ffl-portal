import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

export type PipelineAccessUser = {
  role?: string | UserRole | null;
};

function normalizeRole(role?: string | UserRole | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

export function canAccessPipelinePortal(user: PipelineAccessUser) {
  const role = normalizeRole(user.role);
  if (!role) return false;
  return role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER || isAdmin(role);
}
