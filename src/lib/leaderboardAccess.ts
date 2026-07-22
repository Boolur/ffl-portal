import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

export type LeaderboardAccessUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

function normalizeRole(role?: string | UserRole | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

export function canAccessLeaderboardPortal(user: LeaderboardAccessUser) {
  const role = normalizeRole(user.role);
  if (role && isAdmin(role)) return true;
  if (!role) return false;
  return role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER;
}
