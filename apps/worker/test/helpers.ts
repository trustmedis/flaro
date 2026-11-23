// Test helpers mirroring pusher-js spec/javascripts/helpers/{waitsFor,integration}.js
// and integration_tests_server's /auth + /v2/send endpoints.
import PusherClient from 'pusher-js';
import PusherServer from 'pusher';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface TestApp { appId: string; secret: string; port: number }

let cached: TestApp | null = null;
export function testApp(): TestApp {
  if (!cached) {
    cached = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '.test-app.json'), 'utf8'),
    ) as TestApp;
  }
  return cached;
}

export function server(): PusherServer {
  const { appId, secret, port } = testApp();
  return new PusherServer({ appId, key: appId, secret, host: '127.0.0.1', port, useTLS: false });
}

// Mirrors integration_tests_server POST /auth: authorizeChannel with
// channel_data = { user_id: socket_id, user_info: {...} } for every channel.
export function memberDataFor(socketId: string) {
  return {
    user_id: socketId,
    user_info: {
      name: `Integration ${socketId}`,
      email: `integration-${socketId}@example.com`,
    },
  };
}

export function newPusher(): PusherClient {
  const { appId, port } = testApp();
  const srv = server();
  return new PusherClient(appId, {
    wsHost: '127.0.0.1',
    wsPort: port,
    forceTLS: false,
    enabledTransports: ['ws'],
    disableStats: true,
    cluster: 'dev',
    channelAuthorization: {
      customHandler: ({ socketId, channelName }, cb) => {
        cb(null, srv.authorizeChannel(socketId, channelName, memberDataFor(socketId)));
      },
    },
  });
}

export function getRandomName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function waitsFor(cond: () => boolean, desc: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${desc}`);
    await delay(50);
  }
}

export function subscribe(pusher: PusherClient, channelName: string, callback: (channel: any, param?: any) => void) {
  const channel = pusher.subscribe(channelName);
  channel.bind('pusher:subscription_succeeded', (param: any) => callback(channel, param));
  return channel;
}

// --- raw fetch/WebSocket helpers for the lifecycle + DO test files ---

const TEST_PORT = Number(process.env.PUSHER_TEST_PORT ?? 8791);
const TEST_ADMIN_SECRET = (() => {
  try {
    const dv = readFileSync(path.join(import.meta.dirname, '..', '.dev.vars'), 'utf8');
    const m = dv.match(/^ADMIN_SECRET=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* .dev.vars may not exist yet */ }
  return process.env.PUSHER_TEST_ADMIN_SECRET ?? 'pusher-compat-admin-secret';
})();

export const BASE = `http://127.0.0.1:${TEST_PORT}`;
export const WS_BASE = `ws://127.0.0.1:${TEST_PORT}`;
export const ADMIN = TEST_ADMIN_SECRET;

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
