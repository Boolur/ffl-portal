import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

export type LeaderboardAccessUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

const LEADERBOARD_PILOT_EMAIL = 'mmahjoub@federalfirstlending.com';
const LEADERBOARD_PILOT_NAME = 'matt mahjoub';

function normalizeRole(role?: string | UserRole | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

function normalize(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

export function canAccessLeaderboardPortal(user: LeaderboardAccessUser) {
  const isPilotUser =
    normalize(user.email) === LEADERBOARD_PILOT_EMAIL ||
    normalize(user.name) === LEADERBOARD_PILOT_NAME;
  if (!isPilotUser) return false;

  const role = normalizeRole(user.role);
  if (!role) return false;
  return role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER || isAdmin(role);
}
