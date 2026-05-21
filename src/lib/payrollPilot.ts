import { UserRole } from '@prisma/client';

export type PayrollPilotUser = {
  role?: string | UserRole | null;
  email?: string | null;
  name?: string | null;
};

const PILOT_EMAIL = 'mmahjoub@federalfirstlending.com';
const PILOT_NAME = 'matt mahjoub';

export function isPayrollPilotUser(user: PayrollPilotUser) {
  const email = String(user.email || '')
    .trim()
    .toLowerCase();
  const name = String(user.name || '')
    .trim()
    .toLowerCase();
  return email === PILOT_EMAIL || name === PILOT_NAME;
}

export function isPayrollRolloutEnabled() {
  const raw = String(
    process.env.NEXT_PUBLIC_PAYROLL_ROLLOUT || process.env.PAYROLL_ROLLOUT || ''
  )
    .trim()
    .toLowerCase();
  return raw === 'all' || raw === 'enabled' || raw === 'true';
}

export function canAccessPayrollPortal(user: PayrollPilotUser) {
  const role = String(user.role || '').toUpperCase();
  if (role !== UserRole.LOAN_OFFICER) return false;
  return isPayrollRolloutEnabled() || isPayrollPilotUser(user);
}
