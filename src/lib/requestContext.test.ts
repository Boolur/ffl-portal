import { describe, expect, it } from 'vitest';
import { getRequestClientMeta } from './requestContext';

describe('getRequestClientMeta', () => {
  it('prefers the Vercel forwarded address', () => {
    expect(
      getRequestClientMeta({
        'x-vercel-forwarded-for': '203.0.113.10',
        'x-forwarded-for': '198.51.100.4',
        'user-agent': 'Example Browser',
      }),
    ).toEqual({
      ipAddress: '203.0.113.10',
      userAgent: 'Example Browser',
      city: null,
      region: null,
      country: null,
    });
  });

  it('uses the first address in a forwarded chain', () => {
    expect(
      getRequestClientMeta({
        'x-forwarded-for': '198.51.100.4, 10.0.0.2',
      }).ipAddress,
    ).toBe('198.51.100.4');
  });

  it('returns null metadata when headers are unavailable', () => {
    expect(getRequestClientMeta({})).toEqual({
      ipAddress: null,
      userAgent: null,
      city: null,
      region: null,
      country: null,
    });
  });

  it('limits stored user-agent length', () => {
    const result = getRequestClientMeta({
      'user-agent': 'a'.repeat(600),
    });

    expect(result.userAgent).toHaveLength(512);
  });

  it('captures and decodes Vercel location headers', () => {
    const result = getRequestClientMeta({
      'x-vercel-ip-city': 'San%20Francisco',
      'x-vercel-ip-country-region': 'CA',
      'x-vercel-ip-country': 'us',
    });

    expect(result).toMatchObject({
      city: 'San Francisco',
      region: 'CA',
      country: 'US',
    });
  });
});
