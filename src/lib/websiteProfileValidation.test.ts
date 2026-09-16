import { describe, expect, it } from 'vitest';
import {
  isValidExternalHttpUrl,
  isValidWebsitePhotoUrl,
} from './websiteProfileValidation';

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
