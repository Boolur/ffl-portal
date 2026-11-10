import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, type NextFetchEvent } from 'next/server';
import { encode } from 'next-auth/jwt';
import type { NextRequestWithAuth } from 'next-auth/middleware';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import proxy, { config } from './proxy';
import { CURRENT_SESSION_GENERATION } from './lib/sessionGeneration';

const origin = 'https://bisuportal.com';
const documentPath = '/api/processing-submission/package/files/file';
const secret = 'document-proxy-test-secret-not-a-production-credential';
const event = {} as NextFetchEvent;

beforeEach(() => {
  vi.stubEnv('NEXTAUTH_URL', origin);
  vi.stubEnv('NEXTAUTH_SECRET', secret);
});
afterEach(() => vi.unstubAllEnvs());

async function sessionCookie(role: string, options: { maxAge?: number; generation?: string; activeRole?: string } = {}) {
  const token = await encode({
    secret,
    token: { sub: 'test-user', role, activeRole: options.activeRole, sessionGeneration: options.generation ?? CURRENT_SESSION_GENERATION },
    maxAge: options.maxAge ?? 3600,
  });
  return `__Secure-next-auth.session-token=${token}`;
}

async function run(path = documentPath, cookie?: string, method = 'GET') {
  const request = new NextRequest(`${origin}${path}`, { method, headers: cookie ? { Cookie: cookie } : undefined });
  return proxy(request as NextRequestWithAuth, event);
}

async function expectDocumentDenied(response: Awaited<ReturnType<typeof run>>) {
  expect(response?.status).toBe(403);
  expect(response?.headers.get('Location')).toBeNull();
  expect(response?.headers.get('Content-Disposition')).toBeNull();
  expect(response?.headers.get('Content-Type')).toContain('application/json');
  expect(response?.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(await response?.json()).toEqual({ success: false, error: 'Sign in with an account that can access this document.' });
}

describe('document access through real NextAuth middleware', () => {
  it.each(['', '?prepare=1', '?download=1'])('rejects signed-out document reads without redirecting to HTML: %s', async query => {
    expect(unstable_doesMiddlewareMatch({ config, url: `${origin}${documentPath}${query}` })).toBe(true);
    await expectDocumentDenied(await run(`${documentPath}${query}`));
  });

  it('rejects an expired session before the file handler', async () => {
    await expectDocumentDenied(await run(`${documentPath}?download=1`, await sessionCookie('ADMIN_III', { maxAge: -3600 })));
  });

  it('rejects a retired session generation before the file handler', async () => {
    await expectDocumentDenied(await run(documentPath, await sessionCookie('ADMIN_III', { generation: 'retired' })));
  });

  it.each(['ONBOARDING', 'DISCLOSURE_SPECIALIST', 'QC'])('preserves the role denial for %s', async role => {
    await expectDocumentDenied(await run(documentPath, await sessionCookie(role)));
  });

  it.each(['LOAN_OFFICER', 'PROCESSOR_JR', 'MANAGER', 'ADMIN_III'])('passes %s through to document-level authorization', async role => {
    expect(await run(`${documentPath}?download=1`, await sessionCookie(role))).toBeUndefined();
  });

  it('continues to honor the active role', async () => {
    await expectDocumentDenied(await run(documentPath, await sessionCookie('ADMIN_III', { activeRole: 'ONBOARDING' })));
    expect(await run(documentPath, await sessionCookie('ADMIN_III', { activeRole: 'PROCESSOR_JR' }))).toBeUndefined();
  });

  it.each([
    ['/tasks', 'GET'],
    ['/api/processing-submission/package', 'GET'],
    [`${documentPath}/other`, 'GET'],
    [documentPath, 'POST'],
    [documentPath, 'HEAD'],
  ])('preserves the existing login redirect outside document GET: %s %s', async (path, method) => {
    const response = await run(path, undefined, method);
    expect(response?.status).toBe(307);
    const redirect = new URL(response?.headers.get('Location') ?? '');
    expect(redirect.pathname).toBe('/login');
    expect(redirect.searchParams.get('callbackUrl')).toBe(path);
  });
});
