import { describe, expect, it } from 'vitest';
import {
  isValidExternalHttpUrl,
  isValidWebsitePhotoUrl,
  requiresNmlsForWebsiteTitle,
} from './websiteProfileValidation';

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

describe('website profile URLs', () => {
  it('accepts absolute and root-relative officer photos', () => {
    expect(isValidWebsitePhotoUrl('/officers/jane-doe.png')).toBe(true);
    expect(isValidWebsitePhotoUrl('https://images.example.com/jane-doe.png')).toBe(true);
  });

  it('rejects unsafe or malformed photo URLs', () => {
    expect(isValidWebsitePhotoUrl('//untrusted.example/photo.png')).toBe(false);
    expect(isValidWebsitePhotoUrl('javascript:alert(1)')).toBe(false);
  });

  it('requires booking links to be absolute HTTP URLs', () => {
    expect(isValidExternalHttpUrl('https://calendar.example.com/jane')).toBe(true);
    expect(isValidExternalHttpUrl('/book/jane')).toBe(false);
  });
});
