import { describe, expect, it } from 'vitest';
import { assertStoredUpload } from './storedUploadVerification';
const file = { name: 'test.pdf', size: 123, type: 'application/pdf' };
describe('stored upload verification', () => {
  it.each([
    { size: 123, contentType: 'application/pdf' },
    { metadata: { size: 123, mimetype: 'application/pdf' } },
    { size: 123, metadata: { mimetype: 'application/pdf' } },
  ])('accepts current and legacy storage information', data => {
    expect(() => assertStoredUpload({ data, error: null }, file)).not.toThrow();
  });
  it.each([
    { size: 12, contentType: 'application/pdf' },
    { size: 123, contentType: 'image/png' },
    { size: 0, contentType: 'application/pdf', metadata: { size: 123 } },
    { size: 123, contentType: 'image/png', metadata: { mimetype: 'application/pdf' } },
  ])('rejects mismatches and does not override current data with legacy data', data => {
    expect(() => assertStoredUpload({ data, error: null }, file)).toThrow('size or type does not match');
  });
  it('distinguishes missing files, storage failures, and incomplete metadata', () => {
    expect(() => assertStoredUpload({ data: null, error: { status: 404 } }, file)).toThrow('not found');
    expect(() => assertStoredUpload({ data: null, error: null }, file)).toThrow('not found');
    expect(() => assertStoredUpload({ data: null, error: { statusCode: '503' } }, file)).toThrow('do not need to re-upload');
    expect(() => assertStoredUpload({ data: {}, error: null }, file)).toThrow('incomplete file information');
  });
});
