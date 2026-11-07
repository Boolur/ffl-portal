import { randomBytes } from 'node:crypto';
import { decode, encode, type JWT } from 'next-auth/jwt';
import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_GENERATION, decodePortalSession } from './sessionGeneration';

const secret = randomBytes(32).toString('hex');
const userClaims = { id: 'test-user', role: 'LOAN_OFFICER', activeRole: 'LOAN_OFFICER' };

async function encryptedSession(claims: JWT, maxAge = 60) {
  return encode({ secret, token: claims, maxAge });
}

describe('portal session generation', () => {
  it('accepts a genuine current encrypted session without changing its claims', async () => {
    const token = await encryptedSession({ ...userClaims, sessionGeneration: CURRENT_SESSION_GENERATION });
    const expected = await decode({ secret, token });
    expect(await decodePortalSession({ secret, token })).toEqual(expected);
  });

  it('rejects a genuine legacy session without stamping a new generation', async () => {
    const token = await encryptedSession(userClaims);
    expect(await decode({ secret, token })).toMatchObject(userClaims);
    expect(await decodePortalSession({ secret, token })).toBeNull();
    expect(await decode({ secret, token })).not.toHaveProperty('sessionGeneration');
  });

  it('returns no session when the cookie is missing', async () => {
    expect(await decodePortalSession({ secret })).toBeNull();
  });

  it.each([
    'previous-session-generation',
    `${CURRENT_SESSION_GENERATION} `,
    null,
    1,
    true,
    [CURRENT_SESSION_GENERATION],
    { value: CURRENT_SESSION_GENERATION },
  ])('rejects a generation that does not strictly match: %j', async (sessionGeneration) => {
    // Deliberately forge malformed claims that production JWT typing forbids.
    const malformedClaims = { ...userClaims, sessionGeneration } as unknown as JWT;
    const token = await encryptedSession(malformedClaims);
    expect(await decodePortalSession({ secret, token })).toBeNull();
  });

  it('retains the default decoder expiry validation for current-generation tokens', async () => {
    // Beyond the default decoder clock tolerance of 15 seconds.
    const token = await encryptedSession({ ...userClaims, sessionGeneration: CURRENT_SESSION_GENERATION }, -60);
    await expect(decodePortalSession({ secret, token })).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
  });

  it('retains authenticated decryption and rejects tampered ciphertext', async () => {
    const token = await encryptedSession({ ...userClaims, sessionGeneration: CURRENT_SESSION_GENERATION });
    const parts = token.split('.');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    await expect(decodePortalSession({ secret, token: parts.join('.') })).rejects.toThrow();
  });

  it('rejects a token encrypted with another secret', async () => {
    const token = await encryptedSession({ ...userClaims, sessionGeneration: CURRENT_SESSION_GENERATION });
    await expect(decodePortalSession({ secret: randomBytes(32).toString('hex'), token })).rejects.toThrow();
  });

  it('forwards optional key-derivation parameters to the default decoder', async () => {
    const salt = 'test-session-salt';
    const token = await encode({ secret, salt, token: { ...userClaims, sessionGeneration: CURRENT_SESSION_GENERATION } });
    expect(await decodePortalSession({ secret, salt, token })).toMatchObject(userClaims);
    await expect(decodePortalSession({ secret, token })).rejects.toThrow();
  });
});
