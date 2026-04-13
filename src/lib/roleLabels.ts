import { UserRole } from '@prisma/client';

const ROLE_LABEL_OVERRIDES: Partial<Record<UserRole, string>> = {
  [UserRole.VA_APPRAISAL]: 'Appraisal Specialist',
};

export function getRoleDisplayLabel(role: string | UserRole | null | undefined) {
  const normalized = String(role || '').trim().toUpperCase() as UserRole;
  if (!normalized) return '';
  if (ROLE_LABEL_OVERRIDES[normalized]) {
    return ROLE_LABEL_OVERRIDES[normalized] as string;
  }
  return normalized.replace(/_/g, ' ');
}
