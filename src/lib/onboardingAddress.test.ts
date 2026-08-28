import { describe, expect, it } from 'vitest';
import { isCompleteOnboardingAddress } from './onboardingAddress';

const validAddress = {
  addressLine1: '123 Main Street',
  city: 'Las Vegas',
  state: 'NV',
  postalCode: '89101',
};

describe('isCompleteOnboardingAddress', () => {
  it('accepts five-digit and ZIP+4 postal codes', () => {
    expect(isCompleteOnboardingAddress(validAddress)).toBe(true);
    expect(
      isCompleteOnboardingAddress({ ...validAddress, postalCode: '89101-1234' }),
    ).toBe(true);
  });

  it('requires line 1, city, a two-letter state, and a valid ZIP', () => {
    expect(isCompleteOnboardingAddress({ ...validAddress, addressLine1: '' })).toBe(false);
    expect(isCompleteOnboardingAddress({ ...validAddress, city: '' })).toBe(false);
    expect(isCompleteOnboardingAddress({ ...validAddress, state: 'Nevada' })).toBe(false);
    expect(isCompleteOnboardingAddress({ ...validAddress, state: 'ZZ' })).toBe(false);
    expect(isCompleteOnboardingAddress({ ...validAddress, postalCode: '8910' })).toBe(false);
    expect(isCompleteOnboardingAddress({ ...validAddress, postalCode: '89101 1234' })).toBe(false);
  });
});
