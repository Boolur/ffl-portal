import { describe, expect, it } from 'vitest';
import { requiresNmlsForWebsiteTitle } from './websiteProfileValidation';

describe('requiresNmlsForWebsiteTitle', () => {
  it('does not require NMLS for loan officer assistants', () => {
    expect(requiresNmlsForWebsiteTitle('Loan Officer Assistant')).toBe(false);
    expect(requiresNmlsForWebsiteTitle('Senior Loan Officer Assistant')).toBe(false);
  });

  it('requires NMLS for originator and loan officer titles', () => {
    expect(requiresNmlsForWebsiteTitle('Mortgage Loan Originator')).toBe(true);
    expect(requiresNmlsForWebsiteTitle('Loan Officer')).toBe(true);
  });
});
