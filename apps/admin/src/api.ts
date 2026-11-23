import { z } from 'zod';

export interface AdminApp {
  id: string; name: string; environment: string; status: string;
  createdAt: string; updatedAt?: string;
}
export interface Credential {
  keyId: string; scopes: Array<string>; status: string;
  createdAt: string; expiresAt: string | null; revokedAt: string | null;
}
export interface AuditEntry {
  id: number; actor: string; action: string; applicationId: string;
  metadata: string; timestamp: string;
}
export interface AppLiveStats {
  bandwidthInTimeline: Array<number>; bandwidthOutTimeline: Array<number>;
  channels: number; connections: number; connectionsTimeline: Array<number>;
  deliveredTimeline: Array<number>; disconnectionsTimeline: Array<number>;
  eventsPerMinute: number; eventsTimeline: Array<number>;
  presenceMembers: number; subscribers: number; subscriptionsTimeline: Array<number>;
}
export interface LiveApp {
  id: string; name: string; environment: string; status: string;
  live: AppLiveStats | null;
}
export interface LiveConnection {
  appId: string; appName: string; environment: string;
  channels: Array<string>; connId: string; connectedAt: number;
  host: string; mode: string; sub: string; userAgent: string;
}
export interface ConnectionsResponse { at: string; connections: Array<LiveConnection> }

export interface LiveStatsResponse {
  apps: Array<LiveApp>; at: string;
  totals: {
    bandwidthInTimeline: Array<number>; bandwidthOutTimeline: Array<number>;
    channels: number; connections: number; connectionsTimeline: Array<number>;
    deliveredTimeline: Array<number>; disconnectionsTimeline: Array<number>;
    eventsPerMinute: number; eventsTimeline: Array<number>;
    subscribers: number; subscriptionsTimeline: Array<number>;
  };
}

const apiErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }).partial(),
}).partial();

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
export const setTokenGetter = (g: TokenGetter | null) => { tokenGetter = g; };

// The first requests on page load race ahead of Clerk: child effects run
// before the App effect that registers the getter, and the session token
// itself takes a moment to mint. Wait briefly so requests never leave
// with an empty bearer.
async function waitForToken(): Promise<string | null> {
  for (let i = 0; i < 15; i++) {
    const token = tokenGetter ? await tokenGetter() : null;
    if (token) {return token;}
    await new Promise((resolve) => { setTimeout(resolve, 200); });
  }
  return null;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await waitForToken();
  const headers = new Headers({ authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' });
  new Headers(init?.headers).forEach((v, k) => { headers.set(k, v); });
  const res = await fetch(`/admin${path}`, { ...init, headers });
  const data: unknown = res.ok ? await res.json() : await res.json().catch(() => ({}));
  if (!res.ok) {
    const parsed = apiErrorBody.safeParse(data);
    const err = parsed.success ? parsed.data.error : undefined;
    throw new Error(err?.code ? `${err.code}: ${err.message}` : `HTTP ${res.status}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- api<T> trusts the response shape; callers declare T
  return data as T;
}

// HMAC-SHA256 subscriber token minting (client-side, WebCrypto)
const b64 = (b: ArrayBuffer | string) =>
  btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b)))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

export async function mintSubscriberToken(secret: string, claims: {
  appId: string; sub: string; channels: Array<string>; iss: string; aud: string; ttl: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({
    appId: claims.appId, sub: claims.sub, channels: claims.channels,
    iss: claims.iss, aud: claims.aud, iat: now, exp: now + claims.ttl,
  }));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64(sig)}`;
}
