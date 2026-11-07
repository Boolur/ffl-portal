import { decode, type JWTDecodeParams } from 'next-auth/jwt';

export const CURRENT_SESSION_GENERATION = '2026-11-06-portal-refresh';

/** Accept only sessions issued by the current login flow; never upgrade old tokens. */
export async function decodePortalSession(params: JWTDecodeParams) {
  const token = await decode(params);
  return token?.sessionGeneration === CURRENT_SESSION_GENERATION ? token : null;
}
