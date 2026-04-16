import { UserRole } from '@prisma/client';

export type LeadsPilotUser = {
  role?: string | UserRole | null;
  email?: string | null;
};

const PILOT_EMAILS = new Set([
  'mmahjoub@federalfirstlending.com',
]);

const ADMIN_ROLES = new Set<string>([UserRole.ADMIN, UserRole.MANAGER]);

/**
 * Returns true if the user should see the /leads tab in the sidebar.
 * Admins and Managers always see it. For LO/LOA, only pilot users.
 */
export function canAccessLeadsTab(user: LeadsPilotUser): boolean {
  const role = String(user.role || '').toUpperCase();
  if (!role) return false;

  if (ADMIN_ROLES.has(role)) return true;

  const email = String(user.email || '').trim().toLowerCase();
  return PILOT_EMAILS.has(email);
}
