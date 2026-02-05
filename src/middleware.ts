import { withAuth } from 'next-auth/middleware';

export const middleware = withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks/lead-mailbox|login|_next|favicon.ico|.*\\..*).*)',
  ],
};
