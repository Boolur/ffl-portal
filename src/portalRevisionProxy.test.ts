import { describe, expect, it, vi } from 'vitest';
vi.mock('next-auth/middleware', () => ({ withAuth: (config: unknown) => config }));
import proxy from './proxy';

const { callbacks } = proxy as unknown as { callbacks: { authorized(input: {
  token: { role: string; activeRole?: string } | null;
  req: { method: string; nextUrl: { pathname: string } };
}): boolean } };
const allowed = (role: string | null, pathname = '/api/portal/revisions', method = 'GET', activeRole?: string) =>
  callbacks.authorized({ token: role ? { role, activeRole } : null, req: { method, nextUrl: { pathname } } });

describe('revision endpoint proxy exception', () => {
  it.each(['ADMIN_III', 'ADMIN_II', 'ADMIN_I', 'MANAGER', 'LOAN_OFFICER', 'LOA', 'DISCLOSURE_SPECIALIST', 'PROCESSOR_JR', 'PROCESSOR_SR', 'PROCESSING_MANAGER'])('passes %s to endpoint-level authorization', role => {
    expect(allowed(role)).toBe(true);
  });
  it.each([null, 'ONBOARDING', 'QC', 'VA', 'UNKNOWN'])('does not give %s new access', role => {
    expect(allowed(role)).toBe(false);
  });
  it('uses active role and does not widen methods, nested URLs or other APIs', () => {
    expect(allowed('ADMIN_III', undefined, undefined, 'ONBOARDING')).toBe(false);
    expect(allowed('LOAN_OFFICER', '/api/portal/revisions', 'POST')).toBe(false);
    expect(allowed('LOAN_OFFICER', '/api/portal/revisions/other')).toBe(false);
    expect(allowed('LOAN_OFFICER', '/api/portal/users')).toBe(false);
  });
});
