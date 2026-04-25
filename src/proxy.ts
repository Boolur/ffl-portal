import { withAuth } from 'next-auth/middleware';
import { UserRole } from '@prisma/client';

// Path allowlists for each admin tier. Admin III is '*' (super-admin).
// Admin II gets: Overview, Tasks, Lead Distribution, Lender Mgmt,
// User Management, plus the common /lenders and /resources pages.
// Admin I gets: the same list MINUS Lead Distribution.
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
  '/admin/leads',
];
const ADMIN_I_PATHS = ADMIN_II_PATHS.filter((p) => !p.startsWith('/admin/leads'));

const roleAllowedPaths: Record<UserRole, string[]> = {
  [UserRole.ADMIN]: ADMIN_III_PATHS,
  [UserRole.ADMIN_III]: ADMIN_III_PATHS,
  [UserRole.ADMIN_II]: ADMIN_II_PATHS,
  [UserRole.ADMIN_I]: ADMIN_I_PATHS,
  [UserRole.MANAGER]: ['/', '/pipeline', '/tasks', '/reports', '/team', '/resources', '/lenders'],
  [UserRole.LOAN_OFFICER]: ['/', '/pipeline', '/tasks', '/resources', '/lenders', '/leads'],
  [UserRole.LOA]: ['/', '/tasks', '/resources', '/lenders', '/leads'],
  [UserRole.DISCLOSURE_SPECIALIST]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA_TITLE]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA_HOI]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA_PAYOFF]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.VA_APPRAISAL]: ['/', '/tasks', '/resources', '/lenders'],
  [UserRole.QC]: ['/', '/tasks', '/resources', '/lenders'],
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

function isAllowed(pathname: string, role?: string | null) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return false;
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
      if (isAllowed(req.nextUrl.pathname, effectiveRole)) return true;
      // Fail-soft for older sessions that might have malformed role claims.
      if (req.nextUrl.pathname.startsWith('/tasks')) return true;
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
