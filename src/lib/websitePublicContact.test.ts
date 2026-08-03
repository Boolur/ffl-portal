import { describe, expect, it } from 'vitest';
import { toBisuPublicEmail } from './websitePublicContact';

describe('toBisuPublicEmail', () => {
  it('replaces a legacy account domain for public display', () => {
    expect(toBisuPublicEmail('loan.officer@legacy.example')).toBe(
      'loan.officer@bisuhomeloans.com',
    );
  });

  it('keeps an existing BISU address unchanged', () => {
    expect(toBisuPublicEmail('loan.officer@bisuhomeloans.com')).toBe(
      'loan.officer@bisuhomeloans.com',
    );
  });
});
