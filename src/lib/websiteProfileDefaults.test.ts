import { describe, expect, it } from 'vitest';
import { buildDefaultWebsiteProfileBio } from './websiteProfileDefaults';

describe('buildDefaultWebsiteProfileBio', () => {
  it('builds the standard biography from the profile name and title', () => {
    expect(buildDefaultWebsiteProfileBio('Alan Hernandez', 'Mortgage Loan Originator')).toBe(
      'Alan Hernandez is a Mortgage Loan Originator with BISU Home Loans, helping clients compare purchase, refinance, and home equity options with clear guidance, fast communication, and a people-first lending experience.',
    );
  });
});
