import { UserRole } from '@prisma/client';

// All three admin tiers as values (excludes the legacy ADMIN value, which the
// app should no longer write). Exported as a plain array so it can be used in
// Prisma `{ role: { in: ADMIN_TIER_ROLES } }` clauses.
export const ADMIN_TIER_ROLES: UserRole[] = [
  UserRole.ADMIN_I,
  UserRole.ADMIN_II,
  UserRole.ADMIN_III,
];

// Any admin role, including the deprecated plain ADMIN value. Useful when we
// need a membership test that also catches stray legacy rows.
export const ANY_ADMIN_ROLES: UserRole[] = [
  UserRole.ADMIN,
  ...ADMIN_TIER_ROLES,
];

export type AdminTier = 1 | 2 | 3;

// Treats the legacy UserRole.ADMIN value as ADMIN_III so any stray rows that
// survived the backfill still behave like a super admin.
export function getAdminTier(role?: UserRole | null): AdminTier | null {
  if (!role) return null;
  if (role === UserRole.ADMIN_III || role === UserRole.ADMIN) return 3;
  if (role === UserRole.ADMIN_II) return 2;
  if (role === UserRole.ADMIN_I) return 1;
  return null;
}

export function isAdmin(role?: UserRole | null): boolean {
  return getAdminTier(role) !== null;
}

export function isAdminIII(role?: UserRole | null): boolean {
  return getAdminTier(role) === 3;
}

// Highest admin tier across a user's roles[]. Returns null if the user has no
// admin role at all (e.g. a pure LO).
export function highestAdminTier(roles?: UserRole[] | null): AdminTier | null {
  if (!roles || roles.length === 0) return null;
  let best: AdminTier | null = null;
  for (const role of roles) {
    const tier = getAdminTier(role);
    if (tier === null) continue;
    if (best === null || tier > best) best = tier;
    if (best === 3) break;
  }
  return best;
}

export function hasAnyAdminRole(roles?: UserRole[] | null): boolean {
  return highestAdminTier(roles) !== null;
}

// Nav / route capability helpers. Operate on the user's full roles[] list so
// multi-hat users (e.g. Admin II + LO) keep their admin surfaces regardless
// of the currently active role.
export const canAccessOverview = (_roles: UserRole[] = []) => true;
export const canAccessTasks = (roles: UserRole[] = []) =>
  roles.length > 0;
export const canAccessLeadDistribution = (roles: UserRole[] = []) =>
  (highestAdminTier(roles) ?? 0) >= 2;
export const canAccessLeadMailbox = (roles: UserRole[] = []) =>
  highestAdminTier(roles) === 3;
export const canAccessEmailSettings = (roles: UserRole[] = []) =>
  highestAdminTier(roles) === 3;
export const canAccessTeamPage = (roles: UserRole[] = []) =>
  highestAdminTier(roles) === 3;
export const canAccessReports = (roles: UserRole[] = []) =>
  highestAdminTier(roles) === 3;
export const canAccessUserManagement = (roles: UserRole[] = []) =>
  hasAnyAdminRole(roles);
export const canAccessLenderManagement = (roles: UserRole[] = []) =>
  hasAnyAdminRole(roles);

// User-management-specific rules.
//
// Admin III can manage anyone.
// Admin II can manage anyone whose highest tier is strictly below 2 (so: Admin
//   I, Manager, LO, etc., but NOT another Admin II or Admin III).
// Admin I can only manage users with no admin tier at all.
// Non-admins cannot manage anyone.
export function canManageUser(
  actorRoles: UserRole[] | undefined | null,
  targetRoles: UserRole[] | undefined | null,
): boolean {
  const actorTier = highestAdminTier(actorRoles) ?? 0;
  const targetTier = highestAdminTier(targetRoles) ?? 0;
  if (actorTier === 0) return false;
  if (actorTier === 3) return true;
  if (actorTier === 2) return targetTier < 2;
  if (actorTier === 1) return targetTier === 0;
  return false;
}

// Can the actor assign `desiredRole` to someone? Also naturally prevents
// self-promotion because the same check fires on every role in the new
// roles[] array the caller is trying to persist.
export function canAssignRole(
  actorRoles: UserRole[] | undefined | null,
  desiredRole: UserRole,
): boolean {
  const actorTier = highestAdminTier(actorRoles) ?? 0;
  const desiredTier = getAdminTier(desiredRole) ?? 0;
  if (actorTier === 0) return false;
  if (actorTier === 3) return true;
  if (actorTier === 2) return desiredTier <= 2;
  if (actorTier === 1) return desiredTier === 0;
  return false;
}

// Returns the list of UserRole values the actor is allowed to assign to
// other users (for populating dropdowns in the UI).
export function assignableRolesFor(actorRoles: UserRole[] | undefined | null): UserRole[] {
  // The legacy ADMIN value is never presented as an assignable option.
  const candidates = Object.values(UserRole).filter(
    (r) => r !== UserRole.ADMIN,
  ) as UserRole[];
  return candidates.filter((r) => canAssignRole(actorRoles, r));
}
