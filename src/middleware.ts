export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/((?!api/auth|api/webhooks/lead-mailbox|login|_next|favicon.ico|.*\\..*).*)',
  ],
};
