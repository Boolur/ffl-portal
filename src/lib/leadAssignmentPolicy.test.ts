import { describe, expect, it } from 'vitest';
import { isEmailOnlyWebLead } from './leadAssignmentPolicy';

describe('isEmailOnlyWebLead', () => {
  it('uses email-only assignment effects for WebLead sources', () => {
    expect(isEmailOnlyWebLead('WebLead')).toBe(true);
    expect(isEmailOnlyWebLead(' weblead ')).toBe(true);
  });

  it('keeps normal assignment effects for other lead sources', () => {
    expect(isEmailOnlyWebLead('Lead Mailbox')).toBe(false);
    expect(isEmailOnlyWebLead(null)).toBe(false);
  });
});
