import { UserRole } from '@prisma/client';

const ROLE_LABEL_OVERRIDES: Partial<Record<UserRole, string>> = {
  [UserRole.VA_APPRAISAL]: 'Appraisal Specialist',
  // Any lingering legacy ADMIN row renders as Admin III for visual parity
  // with the backfill migration.
  [UserRole.ADMIN]: 'Admin III',
  [UserRole.ADMIN_I]: 'Admin I',
  [UserRole.ADMIN_II]: 'Admin II',
  [UserRole.ADMIN_III]: 'Admin III',
};

export function getRoleDisplayLabel(role: string | UserRole | null | undefined) {
  const normalized = String(role || '').trim().toUpperCase() as UserRole;
  if (!normalized) return '';
  if (ROLE_LABEL_OVERRIDES[normalized]) {
    return ROLE_LABEL_OVERRIDES[normalized] as string;
  }
  return normalized.replace(/_/g, ' ');
}
