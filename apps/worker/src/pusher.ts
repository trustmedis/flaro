import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { applications } from './db/schema';
import { AuthError, hmacSha256 } from './auth';
import type { Env } from './env';

// Pusher REST API signature verification.
// Canonical string: METHOD\n/apps/<id>/<path>\n<sorted query params excluding auth_signature>
export async function verifyPusherSignature(env: Env, method: string, appId: string, url: URL, rawBody: string): Promise<void> {
  const q = new URLSearchParams(url.search);
  const signature = q.get('auth_signature');
  const key = q.get('auth_key');
  const timestamp = q.get('auth_timestamp');
  if (!signature || !key || !timestamp) throw new AuthError('invalid_auth', 'missing pusher auth params', 401);
  if (key !== appId) throw new AuthError('invalid_auth', 'auth_key does not match app id', 401);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 600) throw new AuthError('invalid_auth', 'stale timestamp', 401);

  if (method === 'POST' || method === 'PUT') {
    const bodyMd5 = q.get('body_md5');
    if (!bodyMd5 || createHash('md5').update(rawBody).digest('hex') !== bodyMd5) {
      throw new AuthError('invalid_auth', 'body_md5 mismatch', 401);
    }
  }

  const db = drizzle(env.DB);
  const rows = await db.select({ tokenSecret: applications.tokenSecret, status: applications.status })
    .from(applications).where(eq(applications.id, appId)).limit(1);
  const app = rows[0];
  if (!app) throw new AuthError('not_found', 'application not found', 404);
  if (app.status !== 'active') throw new AuthError('app_disabled', 'application disabled', 410);

  q.delete('auth_signature');
  const qs = [...q.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const expected = await hmacSha256(app.tokenSecret, `${method}\n${url.pathname}\n${qs}`);
  if (expected !== signature.toLowerCase()) throw new AuthError('invalid_auth', 'signature mismatch', 401);
}
