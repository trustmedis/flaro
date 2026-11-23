import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { applications, credentials } from './db/schema';
import { subscriberTokenClaims, TOKEN_AUDIENCE, MAX_TOKEN_TTL_SECONDS } from '@internal/realtime-protocol';
import type { Env } from './env';
import type { SubscriberTokenClaims } from '@internal/realtime-protocol';

export class AuthError extends Error {
  constructor(public code: string, message: string, public status = 401) {
    super(message);
  }
}

const te = new TextEncoder();

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, te.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return bin;
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function mintApiKey(): { keyId: string; secret: string; apiKey: string } {
  const keyId = `key_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const secret = randomToken(24);
  return { keyId, secret, apiKey: `rth_${keyId}_${secret}` };
}

export interface ApiKeyAuth {
  applicationId: string;
  credentialId: string;
  scopes: string[];
}

export async function verifyApiKey(env: Env, authorization: string | undefined, requiredScope: string): Promise<ApiKeyAuth> {
  if (!authorization?.startsWith('Bearer ')) throw new AuthError('missing_credentials', 'missing bearer token');
  const token = authorization.slice(7).trim();
  const m = /^rth_(key_[A-Za-z0-9]+)_([A-Za-z0-9]+)$/.exec(token);
  if (!m) throw new AuthError('invalid_credentials', 'malformed api key');
  const [, keyId, secret] = m;

  const db = drizzle(env.DB);
  const rows = await db
    .select({ cred: credentials, appStatus: applications.status })
    .from(credentials)
    .innerJoin(applications, eq(credentials.applicationId, applications.id))
    .where(eq(credentials.keyId, keyId!))
    .limit(1);
  const row = rows[0];
  if (!row) throw new AuthError('invalid_credentials', 'unknown api key');
  const { cred, appStatus } = row;

  const hash = await sha256Hex(secret!);
  if (!timingSafeEqual(hash, cred.secretHash)) throw new AuthError('invalid_credentials', 'bad api key secret');
  if (cred.status !== 'active' || cred.revokedAt) throw new AuthError('key_revoked', 'api key revoked');
  if (cred.expiresAt && cred.expiresAt.getTime() < Date.now()) throw new AuthError('key_expired', 'api key expired');
  if (appStatus !== 'active') throw new AuthError('app_disabled', 'application disabled');
  const scopes: string[] = JSON.parse(cred.scopes);
  if (!scopes.includes(requiredScope)) throw new AuthError('insufficient_scope', `missing scope ${requiredScope}`, 403);
  return { applicationId: cred.applicationId, credentialId: cred.id, scopes };
}

export async function verifySubscriberToken(env: Env, token: string): Promise<SubscriberTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('invalid_token', 'malformed token');
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string };
  let rawClaims: unknown;
  try {
    header = JSON.parse(b64urlDecode(h));
    rawClaims = JSON.parse(b64urlDecode(p));
  } catch {
    throw new AuthError('invalid_token', 'malformed token payload');
  }
  if (header.alg !== 'HS256') throw new AuthError('invalid_token', 'unsupported alg');

  const parsed = subscriberTokenClaims.safeParse(rawClaims);
  if (!parsed.success) throw new AuthError('invalid_token', 'invalid token claims');
  const claims = parsed.data;
  if (claims.aud !== TOKEN_AUDIENCE) throw new AuthError('invalid_token', 'bad audience');

  const db = drizzle(env.DB);
  const apps = await db.select().from(applications).where(eq(applications.id, claims.appId)).limit(1);
  const app = apps[0];
  if (!app) throw new AuthError('invalid_token', 'unknown application');
  if (app.status !== 'active') throw new AuthError('app_disabled', 'application disabled', 403);

  const expected = await hmacSha256(app.tokenSecret, `${h}.${p}`);
  const sigOk = b64urlToHexCompare(s, expected);
  if (!sigOk) throw new AuthError('invalid_token', 'bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) throw new AuthError('token_expired', 'token expired');
  if (claims.exp - claims.iat > MAX_TOKEN_TTL_SECONDS) throw new AuthError('invalid_token', 'token ttl too long');
  if (claims.iat > now + 60) throw new AuthError('invalid_token', 'token issued in the future');
  return claims;
}

function b64urlToHexCompare(sig: string, expectedHex: string): boolean {
  const b64 = sig.replace(/-/g, '+').replace(/_/g, '/');
  let bin: string;
  try {
    bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return false;
  }
  const hex = [...bin].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, expectedHex);
}
