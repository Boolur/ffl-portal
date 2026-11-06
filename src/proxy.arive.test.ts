import { describe, expect, it, vi } from 'vitest';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('next-auth/middleware', () => ({ withAuth: vi.fn(() => vi.fn()) }));
import { config } from './proxy';

describe('Arive scheduled route authorization boundary', () => {
  it('lets the cron route perform its own bearer authorization without a browser session', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: 'https://bisuportal.com/api/internal/arive/sync' })).toBe(false);
  });
  it.each(['/pipeline', '/admin/arive', '/api/internal/arive/sync-untrusted', '/api/internal/arive/other'])('retains session protection for %s', path => {
    expect(unstable_doesMiddlewareMatch({ config, url: `https://bisuportal.com${path}` })).toBe(true);
  });
});
