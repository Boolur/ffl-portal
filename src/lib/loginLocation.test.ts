import { describe, expect, it } from 'vitest';
import {
  formatLoginLocation,
  HQ_IP_ADDRESS,
  isHqIp,
} from './loginLocation';

describe('login location labels', () => {
  it('labels the known office address as HQ', () => {
    expect(isHqIp(HQ_IP_ADDRESS)).toBe(true);
    expect(formatLoginLocation({ ipAddress: HQ_IP_ADDRESS })).toBe('HQ office');
  });

  it('formats captured city, region, and country', () => {
    expect(
      formatLoginLocation({
        ipAddress: '203.0.113.10',
        city: 'San Francisco',
        region: 'CA',
        country: 'US',
      }),
    ).toBe('San Francisco, CA, US');
  });

  it('marks missing provider location data as unavailable', () => {
    expect(formatLoginLocation({ ipAddress: '203.0.113.10' })).toBe(
      'Location unavailable',
    );
  });
});
