import { Hono } from 'hono';
import { z } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  MAX_EVENT_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  publishRequest,
} from '@internal/realtime-protocol';
import { AuthError, verifyApiKey, verifySubscriberToken } from './auth';
import { registerAdminRoutes, type AppEnv } from './admin';
import { ApplicationDO } from './do/ApplicationDO';
import type { Env } from './env';

export { ApplicationDO };

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  if (err instanceof AuthError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
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
  if (!token) throw new AuthError('missing_token', 'token query param required');
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

registerAdminRoutes(app);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
};

