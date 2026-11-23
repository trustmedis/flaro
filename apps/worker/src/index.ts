import { Hono } from 'hono';
import { z } from 'zod';
import {
  jsonValue,
  MAX_EVENT_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  publishRequest,
} from '@internal/realtime-protocol';
import type { JsonValue } from '@internal/realtime-protocol';
import { AuthError, verifyApiKey, verifySubscriberToken } from './auth';
import { verifyPusherSignature } from './pusher';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { applications } from './db/schema';
import { registerAdminRoutes } from './admin';
import type { AppEnv } from './admin';
import { ApplicationDO } from './do/application-do';
import type { Env } from './env';

export { ApplicationDO };

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  if (err instanceof SyntaxError) {
    return c.json({ error: { code: 'invalid_json', message: 'request body is not valid JSON' } }, 400);
  }
  if (err instanceof z.ZodError) {
    return c.json({ error: { code: 'invalid_request', message: 'request failed validation' } }, 400);
  }
  console.error('unhandled error', err);
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
});

app.get('/health', (c) =>
  c.json({ ok: true, service: 'realtime-hub', protocol: PROTOCOL_VERSION }));

app.get('/v1/connect', async (c) => {
  const token = c.req.query('token');
  if (!token) {throw new AuthError('missing_token', 'token query param required');}
  const claims = await verifySubscriberToken(c.env, token);
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(claims.appId));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-rth-claims', JSON.stringify(claims));
  headers.delete('authorization');
  const forwarded = new Request(c.req.raw.url, { method: 'GET', headers });
  return stub.fetch(forwarded);
});

app.post('/v1/apps/:appId/events', async (c) => {
  const auth = await verifyApiKey(c.env, c.req.header('authorization'), 'events:publish');
  const appId = c.req.param('appId');
  if (auth.applicationId !== appId) {
    throw new AuthError('app_mismatch', 'credentials do not belong to this application', 403);
  }
  const raw = await c.req.text();
  if (raw.length > MAX_EVENT_PAYLOAD_BYTES + 4096) {
    throw new AuthError('payload_too_large', 'request body too large', 413);
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new AuthError('invalid_json', 'body is not valid JSON', 400); }
  const parsed = publishRequest.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'invalid request' } }, 400);
  }
  const payloadBytes = new TextEncoder().encode(JSON.stringify(parsed.data.data ?? null)).length;
  if (payloadBytes > MAX_EVENT_PAYLOAD_BYTES) {
    throw new AuthError('payload_too_large', 'event data exceeds 64KiB', 413);
  }
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(appId));
  const result = await stub.publishEvent(parsed.data.channel, parsed.data.event, parsed.data.data);
  return c.json({ eventId: result.eventId, accepted: true as const });
});

// --- Pusher-compatible WebSocket endpoint ---
// pusher-js connects to /app/<key> where key == appId.
app.get('/app/:key', async (c) => {
  const key = c.req.param('key');
  const db = drizzle(c.env.DB);
  const rows = await db.select({ status: applications.status }).from(applications).where(eq(applications.id, key)).limit(1);
  const appRow = rows[0];
  if (!appRow) {throw new AuthError('not_found', 'application not found', 404);}
  if (appRow.status !== 'active') {throw new AuthError('app_disabled', 'application disabled', 410);}
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(key));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-rth-protocol', 'pusher');
  headers.set('x-rth-app', key);
  headers.delete('authorization');
  const forwarded = new Request(c.req.raw.url, { method: 'GET', headers });
  return stub.fetch(forwarded);
});

// --- Pusher-compatible REST API ---
// POST /apps/:id/events, /batch_events, GET /channels, /channels/:channel
const pusherEventBody = z.object({
  name: z.string().min(1),
  channel: z.string().optional(),
  channels: z.array(z.string()).optional(),
  data: z.unknown().optional(),
  socket_id: z.string().optional(),
});

const pusherBatchBody = z.object({
  batch: z.array(z.object({
    name: z.string(),
    channel: z.string(),
    data: z.unknown().optional(),
    socket_id: z.string().optional(),
  })),
});

// Pusher sends `data` as a JSON-encoded string; decode it when possible and
// otherwise pass it through verbatim.
function decodePusherData(data: unknown): JsonValue {
  let inner = data;
  if (typeof data === 'string') {
    try { inner = JSON.parse(data); } catch { /* keep raw string */ }
  }
  const parsed = jsonValue.safeParse(inner);
  return parsed.success ? parsed.data : null;
}

app.post('/apps/:id/events', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.text();
  await verifyPusherSignature(c.env, 'POST', id, new URL(c.req.url), raw);
  const parsed = pusherEventBody.safeParse(JSON.parse(raw));
  if (!parsed.success || !(parsed.data.channel || parsed.data.channels)) {
    return c.json({ error: { code: 'invalid_request', message: 'need name + channel(s)' } }, 400);
  }
  const data = decodePusherData(parsed.data.data);
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(id));
  const targets = parsed.data.channels ?? (parsed.data.channel === undefined ? [] : [parsed.data.channel]);
  for (const ch of targets) {
    await stub.publishEvent(ch, parsed.data.name, data, parsed.data.socket_id);
  }
  return c.json({});
});

app.post('/apps/:id/batch_events', async (c) => {
  const id = c.req.param('id');
  const raw = await c.req.text();
  await verifyPusherSignature(c.env, 'POST', id, new URL(c.req.url), raw);
  const parsed = pusherBatchBody.safeParse(JSON.parse(raw));
  if (!parsed.success) {return c.json({ error: { code: 'invalid_request', message: 'need batch[]' } }, 400);}
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(id));
  for (const e of parsed.data.batch) {
    await stub.publishEvent(e.channel, e.name, decodePusherData(e.data), e.socket_id);
  }
  return c.json({});
});

app.get('/apps/:id/channels', async (c) => {
  const id = c.req.param('id');
  await verifyPusherSignature(c.env, 'GET', id, new URL(c.req.url), '');
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(id));
  const info = await stub.channelInfo();
  const channels: Record<string, Record<string, never>> = {};
  for (const name of Object.keys(info)) {channels[name] = {};}
  return c.json({ channels });
});

app.get('/apps/:id/channels/:channel', async (c) => {
  const id = c.req.param('id');
  const channel = c.req.param('channel');
  await verifyPusherSignature(c.env, 'GET', id, new URL(c.req.url), '');
  const stub = c.env.APP_DO.get(c.env.APP_DO.idFromName(id));
  const info = await stub.channelInfo();
  const count = info[channel];
  if (count === undefined) {return c.json({ occupied: false });}
  return c.json({ occupied: true, subscription_count: count });
});

registerAdminRoutes(app);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};

