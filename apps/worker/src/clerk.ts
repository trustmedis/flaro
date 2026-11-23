import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTPayload } from 'jose';
import { AuthError } from './auth';
import type { Env } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function verifyClerkAdminToken(env: Env, token: string): Promise<JWTPayload> {
  const issuer = env.CLERK_ISSUER;
  if (!issuer) {throw new AuthError('clerk_not_configured', 'CLERK_ISSUER is not set', 500);}
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, '')}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks, { issuer, algorithms: ['RS256', 'ES256', 'EdDSA'] }));
  } catch {
    throw new AuthError('invalid_token', 'clerk token verification failed');
  }
  return payload;
}
