export const BASE = 'http://127.0.0.1:8990';
export const WS_BASE = 'ws://127.0.0.1:8990';
export const ADMIN = 'test-admin-secret';

export function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
}

export interface CreatedApp { id: string; tokenSecret: string }

export async function createApp(): Promise<CreatedApp> {
  const res = await adminFetch('/admin/apps', { method: 'POST', body: JSON.stringify({ name: 't', environment: 'dev' }) });
  return res.json() as Promise<CreatedApp>;
}

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PusherConn {
  ws: WebSocket;
  connId: string;
  send: (o: object) => void;
  next: (timeoutMs?: number) => Promise<Record<string, unknown>>;
}

export async function pusherConnect(appId: string): Promise<PusherConn> {
  const ws = new WebSocket(`${WS_BASE}/app/${appId}`);
  const inbox: Record<string, unknown>[] = [];
  const waiters: ((m: Record<string, unknown>) => void)[] = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(String(e.data)) as Record<string, unknown>;
    const w = waiters.shift();
    if (w) w(m); else inbox.push(m);
  });
  const next = (timeoutMs = 2000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timed out waiting for frame')), timeoutMs);
      const buffered = inbox.shift();
      if (buffered) {
        clearTimeout(t);
        resolve(buffered);
        return;
      }
      waiters.push((m) => {
        clearTimeout(t);
        resolve(m);
      });
    });
  const established = await next();
  const connId = JSON.parse(String(established.data)).socket_id as string;
  return { ws, connId, send: (o) => ws.send(JSON.stringify(o)), next };
}
