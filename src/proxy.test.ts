import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock('next-auth/middleware', () => ({ withAuth: (config: unknown) => { mocks.config = config; return vi.fn(); } }));
import './proxy';
import { decodePortalSession } from './lib/sessionGeneration';

const { callbacks } = mocks.config as { callbacks: { authorized: (input: { token: { role: string; activeRole?: string } | null; req: { method: string; nextUrl: { pathname: string } } }) => boolean } };
const request = (role: string | null, pathname = '/api/processing-submission/request', method = 'GET', activeRole?: string) => callbacks.authorized({ token: role ? { role, activeRole } : null, req: { method, nextUrl: { pathname } } });

describe('processing submission read access through proxy', () => {
  it('rejects retired session generations before authorizing requests', () => {
    expect((mocks.config as { jwt: { decode: unknown } }).jwt.decode).toBe(decodePortalSession);
  });
  it.each(['PROCESSOR_JR', 'LOAN_OFFICER', 'MANAGER', 'ADMIN_I', 'ADMIN_II', 'ADMIN_III'])('allows %s reads to reach document-level authorization', role => {
    expect(request(role)).toBe(true);
    expect(request(role, '/api/processing-submission/package/files/file')).toBe(true);
  });
  it('supports an Admin using the active Jr role', () => {
    expect(request('ADMIN_III', undefined, undefined, 'PROCESSOR_JR')).toBe(true);
  });
  it.each([null, 'ONBOARDING', 'QC', 'VA', 'DISCLOSURE_SPECIALIST'])('does not grant new access to %s', role => {
    expect(request(role)).toBe(false);
  });
  it('does not widen access to other APIs or methods', () => {
    expect(request('PROCESSOR_JR', '/api/admin/users')).toBe(false);
    expect(request('PROCESSOR_JR', '/api/processing-submission/request', 'POST')).toBe(false);
  });
});
