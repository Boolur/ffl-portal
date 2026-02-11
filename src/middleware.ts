import { withAuth } from 'next-auth/middleware';
import { UserRole } from '@prisma/client';

const roleAllowedPaths: Record<UserRole, string[]> = {
  [UserRole.ADMIN]: ['*'],
  [UserRole.MANAGER]: ['/', '/pipeline', '/reports', '/team', '/resources'],
  [UserRole.LOAN_OFFICER]: ['/', '/pipeline', '/resources'],
  [UserRole.DISCLOSURE_SPECIALIST]: ['/', '/tasks', '/resources'],
  [UserRole.VA]: ['/', '/tasks', '/resources'],
  [UserRole.QC]: ['/', '/tasks', '/resources'],
  [UserRole.PROCESSOR_JR]: ['/', '/tasks', '/resources'],
  [UserRole.PROCESSOR_SR]: ['/', '/tasks', '/resources'],
};

function isAllowed(pathname: string, role?: string | null) {
  if (!role) return false;
  const allowed = roleAllowedPaths[role as UserRole];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  return allowed.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export const middleware = withAuth({
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized: ({ token, req }) => {
      if (!token) return false;
      return isAllowed(req.nextUrl.pathname, token.role as string);
    },
  },
});

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks/lead-mailbox|login|auth|_next|favicon.ico|.*\\..*).*)',
  ],
};
