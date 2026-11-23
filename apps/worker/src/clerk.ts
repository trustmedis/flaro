import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import { AuthError } from './auth';
import type { Env } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function isAdminPayload(p: JWTPayload): boolean {
  const meta = (p.public_metadata ?? p.publicMetadata) as Record<string, unknown> | undefined;
  return p.role === 'admin' || p.org_role === 'admin' || p.org_role === 'org:admin' || meta?.role === 'admin';
}

export async function verifyClerkAdminToken(env: Env, token: string): Promise<JWTPayload> {
  const issuer = env.CLERK_ISSUER;
  if (!issuer) throw new AuthError('clerk_not_configured', 'CLERK_ISSUER is not set', 500);
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
  if (!isAdminPayload(payload)) throw new AuthError('forbidden', 'not an admin', 403);
  return payload;
}
