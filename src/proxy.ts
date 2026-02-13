import { withAuth } from 'next-auth/middleware';
import { UserRole } from '@prisma/client';

const roleAllowedPaths: Record<UserRole, string[]> = {
  [UserRole.ADMIN]: ['*'],
  [UserRole.MANAGER]: ['/', '/pipeline', '/tasks', '/reports', '/team', '/resources'],
  [UserRole.LOAN_OFFICER]: ['/', '/pipeline', '/tasks', '/resources'],
  [UserRole.DISCLOSURE_SPECIALIST]: ['/', '/tasks', '/resources'],
  [UserRole.VA]: ['/', '/tasks', '/resources'],
  [UserRole.VA_TITLE]: ['/', '/tasks', '/resources'],
  [UserRole.VA_HOI]: ['/', '/tasks', '/resources'],
  [UserRole.VA_PAYOFF]: ['/', '/tasks', '/resources'],
  [UserRole.VA_APPRAISAL]: ['/', '/tasks', '/resources'],
  [UserRole.QC]: ['/', '/tasks', '/resources'],
  [UserRole.PROCESSOR_JR]: ['/', '/tasks', '/resources'],
  [UserRole.PROCESSOR_SR]: ['/', '/tasks', '/resources'],
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
      if (isAllowed(req.nextUrl.pathname, token.role as string)) return true;
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
    '/((?!api/auth|api/webhooks/lead-mailbox|login|auth|_next|favicon.ico|.*\\..*).*)',
  ],
};
