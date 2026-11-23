export interface AdminApp {
  id: string; name: string; environment: string; status: string;
  createdAt: string; updatedAt?: string;
}
export interface Credential {
  keyId: string; scopes: string[]; status: string;
  createdAt: string; expiresAt: string | null; revokedAt: string | null;
}
export interface AuditEntry {
  id: number; actor: string; action: string; applicationId: string;
  metadata: string; timestamp: string;
}

type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
export const setTokenGetter = (g: TokenGetter | null) => { tokenGetter = g; };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenGetter ? await tokenGetter() : null;
  const res = await fetch(`/admin${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.code ? `${data.error.code}: ${data.error.message}` : `HTTP ${res.status}`);
  return data as T;
}

// HMAC-SHA256 subscriber token minting (client-side, WebCrypto)
export async function mintSubscriberToken(secret: string, claims: {
  appId: string; sub: string; channels: string[]; iss: string; aud: string; ttl: number;
}): Promise<string> {
  const b64 = (b: ArrayBuffer | string) =>
    btoa(typeof b === 'string' ? b : String.fromCharCode(...new Uint8Array(b)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
