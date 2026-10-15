import { describe, expect, it } from 'vitest';
import { encryptAriveCredentials, decryptAriveCredentials } from './ariveCrypto';
describe('Arive credential encryption', () => {
  const key = 'test-encryption-key-not-a-real-secret-12345';
  it('encrypts credentials with a fresh nonce and round trips', () => {
    const plain = JSON.stringify({ clientId: 'test', secret: 'private-value', apiKey: 'api-value' });
    const sealed = encryptAriveCredentials(plain, key);
    expect(sealed).not.toContain('private-value');
    expect(decryptAriveCredentials(sealed, key)).toBe(plain);
    expect(encryptAriveCredentials(plain, key)).not.toBe(sealed);
  });
  it('rejects another key and modified ciphertext', () => {
    const sealed = encryptAriveCredentials('secret', key);
    expect(() => decryptAriveCredentials(sealed, `${key}-other`)).toThrow();
    const parts = sealed.split('.'); parts[2] = Buffer.alloc(16).toString('base64');
    expect(() => decryptAriveCredentials(parts.join('.'), key)).toThrow();
  });
  it('refuses missing or weak server key configuration', () => {
    expect(() => encryptAriveCredentials('secret', '')).toThrow();
  });
});
