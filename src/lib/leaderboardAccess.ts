import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

export type LeaderboardAccessUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

const LEADERBOARD_PILOT_EMAILS = new Set([
  'mmahjoub@federalfirstlending.com',
  'nyebisu@federalfirstlending.com',
]);
const LEADERBOARD_PILOT_NAMES = new Set([
  'matt mahjoub',
  'nick yebisu',
  'nicholas yebisu',
]);

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
  const role = normalizeRole(user.role);
  if (role && isAdmin(role)) return true;

  const isPilotUser =
    LEADERBOARD_PILOT_EMAILS.has(normalize(user.email)) ||
    LEADERBOARD_PILOT_NAMES.has(normalize(user.name));
  if (!isPilotUser) return false;

  if (!role) return false;
  return role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER;
}
