import { UserRole } from '@prisma/client';

export type LeadsPilotUser = {
  role?: string | UserRole | null;
  email?: string | null;
};

const ALLOWED_ROLES = new Set<string>([
  UserRole.ADMIN,
  UserRole.ADMIN_I,
  UserRole.ADMIN_II,
  UserRole.ADMIN_III,
  UserRole.MANAGER,
  UserRole.LOAN_OFFICER,
]);

/**
 * Returns true if the user should see the /leads tab in the sidebar.
 *
 * The LO pilot (originally gated to a single email) was lifted on
 * 2026-04-28 so every Loan Officer now has access. Admins and Managers
 * continue to see the tab as before. LOAs and other back-office roles
 * do not get access here; they can be added to `ALLOWED_ROLES` if/when
 * that changes.
 */
export function canAccessLeadsTab(user: LeadsPilotUser): boolean {
  const role = String(user.role || '').toUpperCase();
  if (!role) return false;
  return ALLOWED_ROLES.has(role);
}
