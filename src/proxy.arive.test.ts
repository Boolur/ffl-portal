import { describe, expect, it, vi } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('next-auth/middleware', () => ({ withAuth: vi.fn(() => vi.fn()) }));
import { config } from './proxy';

describe('Arive scheduled route authorization boundary', () => {
  it.each(['sync', 'leadership-pilot'])('lets %s authorize the scheduler without a browser session', path => {
    expect(unstable_doesMiddlewareMatch({ config, url: 'https://bisuportal.com/api/internal/arive/' + path })).toBe(false);
  });
  it.each(['/pipeline', '/admin/arive', '/api/internal/arive/sync-untrusted', '/api/internal/arive/leadership-pilot-unsafe', '/api/internal/arive/leadership-pilot/other', '/api/internal/arive/other'])('retains session protection for %s', path => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://bisuportal.com${path}` })).toBe(true);
  });
});
