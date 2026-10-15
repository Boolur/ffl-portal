import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

function key(secret: string) {
  if (secret.length < 32) throw new Error('Server encryption configuration is unavailable.');
  return Buffer.from(hkdfSync('sha256', secret, 'bisu-arive-v1', 'integration-credentials', 32));
}
export function encryptAriveCredentials(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}
export function decryptAriveCredentials(value: string, secret: string) {
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Arive credentials must be entered again.');
  const cipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(ciphertext, 'base64')), cipher.final()]).toString('utf8');
}
