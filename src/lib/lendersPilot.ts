import { UserRole } from '@prisma/client';

export type LendersPilotUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

const PILOT_EMAIL = 'mmahjoub@federalfirstlending.com';
const PILOT_NAME = 'matt mahjoub';

export function isLendersPilotUser(user: LendersPilotUser) {
  const email = String(user.email || '')
    .trim()
    .toLowerCase();
  const name = String(user.name || '')
    .trim()
    .toLowerCase();
  if (!email) return false;
  return email === PILOT_EMAIL || name === PILOT_NAME;
}

export function isLendersRolloutEnabled() {
  const raw = String(
    process.env.NEXT_PUBLIC_LENDERS_ROLLOUT || process.env.LENDERS_ROLLOUT || ''
  )
    .trim()
    .toLowerCase();
  return raw === 'all' || raw === 'enabled' || raw === 'true';
}

export function canAccessLendersDirectory(user: LendersPilotUser) {
  const role = String(user.role || '').toUpperCase();
  if (role === UserRole.ADMIN) return true;
  if (isLendersRolloutEnabled()) return true;
  return isLendersPilotUser(user);
}
