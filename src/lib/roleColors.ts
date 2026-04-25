import { UserRole } from '@prisma/client';

export function getRoleBubbleClass(role: UserRole | null) {
  if (role === UserRole.DISCLOSURE_SPECIALIST) {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }
  if (role === UserRole.QC) {
    return 'border-violet-200 bg-violet-50 text-violet-700';
  }
  if (
    role === UserRole.VA ||
    role === UserRole.VA_TITLE ||
    role === UserRole.VA_PAYOFF ||
    role === UserRole.VA_APPRAISAL ||
    role === UserRole.VA_HOI
  ) {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  if (role === UserRole.LOAN_OFFICER) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (role === UserRole.LOA) {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (role === UserRole.PROCESSOR_JR) {
    return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  }
  if (role === UserRole.MANAGER) {
    return 'border-slate-900 bg-slate-900 text-white';
  }
  // Admin tiers share a blue/indigo family, graduated by intensity so they
  // read as a progression at a glance. Legacy ADMIN matches Admin III.
  if (role === UserRole.ADMIN_III || role === UserRole.ADMIN) {
    return 'border-indigo-700 bg-indigo-700 text-white';
  }
  if (role === UserRole.ADMIN_II) {
    return 'border-indigo-500 bg-indigo-500 text-white';
  }
  if (role === UserRole.ADMIN_I) {
    return 'border-indigo-300 bg-indigo-100 text-indigo-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-500';
}
