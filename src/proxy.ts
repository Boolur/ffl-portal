import { withAuth } from 'next-auth/middleware';
import { UserRole } from '@prisma/client';

const RETIRED_WORKFLOW_ROLES = new Set<UserRole>([
  UserRole.QC,
  UserRole.VA,
  UserRole.VA_TITLE,
  UserRole.VA_HOI,
  UserRole.VA_PAYOFF,
  UserRole.VA_APPRAISAL,
]);

// Path allowlists for each admin tier. Admin III is '*' (super-admin).
// Admin II gets: Overview, Tasks, Payroll, Lead Distribution, Lender Mgmt,
// User Management, plus the common /lenders and /resources pages.
// Admin I gets: the same list MINUS Lead Distribution and Payroll.
// The legacy UserRole.ADMIN value is still mapped to the Admin III
// allowlist so any stray rows behave like super admins.
const ADMIN_III_PATHS = ['*'];
const ADMIN_II_PATHS = [
  '/',
  '/tasks',
  '/resources',
  '/lenders',
  '/admin/users',
  '/admin/lenders',
  '/admin/payroll',
  '/admin/leads',
];
const ADMIN_I_PATHS = ADMIN_II_PATHS.filter(
  (p) => !p.startsWith('/admin/leads') && !p.startsWith('/admin/payroll')
);

const roleAllowedPaths: Record<UserRole, string[]> = {
  [UserRole.ADMIN]: ADMIN_III_PATHS,
  [UserRole.ADMIN_III]: ADMIN_III_PATHS,
  [UserRole.ADMIN_II]: ADMIN_II_PATHS,
  [UserRole.ADMIN_I]: ADMIN_I_PATHS,
  [UserRole.MANAGER]: ['/', '/pipeline', '/tasks', '/reports', '/team', '/resources', '/lenders', '/payroll'],
  [UserRole.LOAN_OFFICER]: ['/', '/pipeline', '/tasks', '/resources', '/lenders', '/leads', '/payroll'],
  [UserRole.LOA]: ['/', '/tasks', '/resources', '/lenders', '/leads'],
  [UserRole.DISCLOSURE_SPECIALIST]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA]: [],
  [UserRole.VA_TITLE]: [],
  [UserRole.VA_HOI]: [],
  [UserRole.VA_PAYOFF]: [],
  [UserRole.VA_APPRAISAL]: [],
  [UserRole.QC]: [],
  [UserRole.PROCESSOR_JR]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.PROCESSOR_SR]: ['/', '/tasks', '/resources', '/lenders'],
};

function normalizeRole(role?: string | null): UserRole | null {
  if (!role) return null;
  const normalized = role.trim().toUpperCase();
  const roles = Object.values(UserRole) as string[];
  if (!roles.includes(normalized)) return null;
  return normalized as UserRole;
}

function isAdminRole(role: UserRole | null) {
  return role === UserRole.ADMIN ||
    role === UserRole.ADMIN_I ||
    role === UserRole.ADMIN_II ||
    role === UserRole.ADMIN_III;
}

function canAccessLeaderboard(pathname: string, role?: string | null) {
  if (pathname !== '/leaderboard' && !pathname.startsWith('/leaderboard/')) return false;
  const normalizedRole = normalizeRole(role);
  if (isAdminRole(normalizedRole)) return true;
  return normalizedRole === UserRole.LOAN_OFFICER ||
    normalizedRole === UserRole.LOA ||
    normalizedRole === UserRole.MANAGER;
}

function isAllowed(pathname: string, role?: string | null) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
  if (RETIRED_WORKFLOW_ROLES.has(normalizedRole)) return false;
  const allowed = roleAllowedPaths[normalizedRole];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

const authProxy = withAuth({
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized: ({ token, req }) => {
      if (!token) return false;
      const effectiveRole = (token.activeRole as string) || (token.role as string);
      if (req.nextUrl.pathname === '/leaderboard' || req.nextUrl.pathname.startsWith('/leaderboard/')) {
        return canAccessLeaderboard(req.nextUrl.pathname, effectiveRole);
      }
      if (isAllowed(req.nextUrl.pathname, effectiveRole)) return true;
      // Fail-soft for older sessions that might have malformed role claims.
      const normalizedRole = normalizeRole(effectiveRole);
      if (
        req.nextUrl.pathname.startsWith('/tasks') &&
        normalizedRole &&
        !RETIRED_WORKFLOW_ROLES.has(normalizedRole)
      ) return true;
      return false;
    },
  },
});

export default authProxy;
export const proxy = authProxy;

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks/lead-mailbox|api/webhooks/leads|login|auth|_next|favicon.ico|.*\\..*).*)',
  ],
};
