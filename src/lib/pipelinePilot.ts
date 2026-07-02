import { UserRole } from '@prisma/client';
import { isAdmin } from '@/lib/adminTiers';

export type PipelinePilotUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

const PIPELINE_PILOT_EMAIL = 'mmahjoub@federalfirstlending.com';

function normalizeEmail(email?: string | null) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeRole(role?: string | UserRole | null): UserRole | null {
  const normalized = String(role || '').trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

export function isPipelinePilotUser(user: PipelinePilotUser) {
  return normalizeEmail(user.email) === PIPELINE_PILOT_EMAIL;
}

export function canAccessPipelinePortal(user: PipelinePilotUser) {
  if (!isPipelinePilotUser(user)) return false;
  const role = normalizeRole(user.role);
  if (!role) return false;
  return role === UserRole.LOAN_OFFICER || role === UserRole.MANAGER || isAdmin(role);
}
