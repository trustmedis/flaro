import { describe, it, expect } from 'vitest';
import { adminFetch, createApp, hmacHex, pusherConnect } from './helpers';

describe('ApplicationDO pusher protocol', () => {

  it('does not fan out client-* events on public channels (#1)', async () => {
    const app = await createApp();
    const a = await pusherConnect(app.id);
    const b = await pusherConnect(app.id);

    a.send({ event: 'pusher:subscribe', data: { channel: 'public-ch' } });
    b.send({ event: 'pusher:subscribe', data: { channel: 'public-ch' } });
    expect((await a.next()).event).toBe('pusher_internal:subscription_succeeded');
    expect((await b.next()).event).toBe('pusher_internal:subscription_succeeded');

    a.send({ event: 'client-inject', channel: 'public-ch', data: { x: 1 } });
    await expect(b.next(300)).rejects.toThrow('timed out');
    a.ws.close();
    b.ws.close();
  });

  it('fans out client-* events on private channels with auth (#1 control)', async () => {
    const app = await createApp();
    const a = await pusherConnect(app.id);
    const b = await pusherConnect(app.id);

    for (const conn of [a, b]) {
      const sig = await hmacHex(app.tokenSecret, `${conn.connId}:private-ch`);
      conn.send({ event: 'pusher:subscribe', data: { channel: 'private-ch', auth: `${app.id}:${sig}` } });
    }
    expect((await a.next()).event).toBe('pusher_internal:subscription_succeeded');
    expect((await b.next()).event).toBe('pusher_internal:subscription_succeeded');

    a.send({ event: 'client-typing', channel: 'private-ch', data: { on: true } });
    const got = await b.next(1000);
    expect(got.event).toBe('client-typing');
    a.ws.close();
    b.ws.close();
  });

  it('verifies private-channel auth against the rotated tokenSecret on a warm DO (#2)', async () => {
    const app = await createApp();
    const a = await pusherConnect(app.id);

    const sig1 = await hmacHex(app.tokenSecret, `${a.connId}:private-rot`);
    a.send({ event: 'pusher:subscribe', data: { channel: 'private-rot', auth: `${app.id}:${sig1}` } });
    expect((await a.next()).event).toBe('pusher_internal:subscription_succeeded');

    const rot = await adminFetch(`/admin/apps/${app.id}/token-secret`, { method: 'POST' });
    const { tokenSecret } = await rot.json<{ tokenSecret: string }>();

    const b = await pusherConnect(app.id); // same DO instance, ws1 still open
    const sig2 = await hmacHex(tokenSecret, `${b.connId}:private-rot2`);
    b.send({ event: 'pusher:subscribe', data: { channel: 'private-rot2', auth: `${app.id}:${sig2}` } });
    expect((await b.next()).event).toBe('pusher_internal:subscription_succeeded');
    a.ws.close();
    b.ws.close();
  });
});
