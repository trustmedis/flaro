import {
  clientMessage,
  isPrivateChannel,
  isPusherPrivateChannel,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  PROTOCOL_VERSION,
  pusherFrame,
  pusherSubscribeData,
  type SubscriberTokenClaims,
} from '@internal/realtime-protocol';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

interface Attachment {
  v: 1;
  connId: string;
  appId: string;
  subs: string[];
  allowed: string[];
  sub: string;
  mode?: 'pusher';
}

interface ConnState {
  ws: WebSocket;
  connId: string;
  subs: Set<string>;
  mode: 'rth' | 'pusher';
}

const PUBLISH_LIMIT_PER_MINUTE = 600;
const MAX_ATTACHMENT_BYTES = 200 * 1024;

export class ApplicationDO extends DurableObject<Env> {
  private indexBuilt = false;
  private conns = new Map<string, ConnState>();
  private channelIndex = new Map<string, Set<string>>();
  private publishWindow: number[] = [];

  private connIdFor(ws: WebSocket): string {
    const att = ws.deserializeAttachment() as Attachment | null;
    return att?.connId ?? '';
  }

  private ensureIndex(): void {
    if (this.indexBuilt) return;
    this.indexBuilt = true;
    this.conns.clear();
    this.channelIndex.clear();
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (!att) continue;
      if (!this.appId && att.appId) this.appId = att.appId;
      const state: ConnState = { ws, connId: att.connId, subs: new Set(att.subs), mode: att.mode ?? 'rth' };
      this.conns.set(att.connId, state);
      for (const ch of att.subs) {
        let set = this.channelIndex.get(ch);
        if (!set) this.channelIndex.set(ch, (set = new Set()));
        set.add(att.connId);
      }
    }
  }

  private appId: string | null = null;

  private async appSecretKey(): Promise<string | null> {
    if (!this.appId) return null;
    const { drizzle } = await import('drizzle-orm/d1');
    const { applications } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await drizzle(this.env.DB).select({ s: applications.tokenSecret }).from(applications).where(eq(applications.id, this.appId)).limit(1);
    return rows[0]?.s ?? null;
  }

  private persistAttachment(state: ConnState, allowed: string[], sub: string, appId?: string): void {
    const att: Attachment = { v: 1, connId: state.connId, appId: appId ?? this.appId ?? '', subs: [...state.subs], allowed, sub, ...(state.mode === 'pusher' ? { mode: 'pusher' as const } : {}) };
    const size = new TextEncoder().encode(JSON.stringify(att)).length;
    if (size > MAX_ATTACHMENT_BYTES) {
      state.ws.close(4009, 'attachment limit');
      return;
    }
    state.ws.serializeAttachment(att);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 400 });
    }

    if (request.headers.get('x-rth-protocol') === 'pusher') {
      const appId = request.headers.get('x-rth-app') ?? '';
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.ctx.acceptWebSocket(server);
      const connId = `conn_${crypto.randomUUID()}`;
      const state: ConnState = { ws: server, connId, subs: new Set(), mode: 'pusher' };
      this.conns.set(connId, state);
      this.indexBuilt = true;
      this.appId = appId;
      this.persistAttachment(state, [], '', appId);
      server.send(JSON.stringify({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: connId, activity_timeout: 120 }) }));
      return new Response(null, { status: 101, webSocket: client });
    }

    const claims = (request.headers.get('x-rth-claims') ?? '') as string;
    let parsed: SubscriberTokenClaims | null = null;
    try { parsed = JSON.parse(claims); } catch { /* handled below */ }
    if (!parsed) return new Response('missing claims', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);

    const connId = `conn_${crypto.randomUUID()}`;
    const state: ConnState = { ws: server, connId, subs: new Set(), mode: 'rth' };
    this.conns.set(connId, state);
    this.indexBuilt = true;
    this.appId = parsed.appId;
    this.persistAttachment(state, parsed.channels, parsed.sub, parsed.appId);

    server.send(JSON.stringify({
      type: 'connection.ready',
      connectionId: connId,
      protocol: PROTOCOL_VERSION,
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureIndex();
    if (typeof message !== 'string') {
      ws.send(JSON.stringify({ type: 'connection.error', error: { code: 'invalid_message', message: 'text frames only' } }));
      return;
    }
    const connId = this.connIdFor(ws);
    const state = this.conns.get(connId);
    if (!state) return;
    if (state.mode === 'pusher') return this.handlePusherMessage(state, message);

    let raw: unknown;
    try { raw = JSON.parse(message); } catch {
      ws.send(JSON.stringify({ type: 'connection.error', error: { code: 'invalid_json', message: 'frame is not JSON' } }));
      return;
    }
    const parsed = clientMessage.safeParse(raw);
    if (!parsed.success) {
      ws.send(JSON.stringify({ type: 'connection.error', error: { code: 'invalid_message', message: 'unrecognized message' } }));
      return;
    }
    const msg = parsed.data;

    if (msg.type === 'subscribe') await this.handleSubscribe(state, msg.channel, msg.requestId, msg.auth);
    else this.handleUnsubscribe(state, msg.channel, msg.requestId);
  }

  private pusherError(state: ConnState, message: string): void {
    state.ws.send(JSON.stringify({ event: 'pusher:error', data: JSON.stringify({ code: null, message }) }));
  }

  private async verifyChannelAuth(auth: string, channel: string, connId: string): Promise<boolean> {
    const secret = await this.appSecretKey();
    if (!secret) return false;
    const idx = auth.indexOf(':');
    const sig = idx === -1 ? '' : auth.slice(idx + 1);
    const { hmacSha256 } = await import('../auth');
    const expected = await hmacSha256(secret, `${connId}:${channel}`);
    return sig.length > 0 && sig.toLowerCase() === expected;
  }

  private async handlePusherMessage(state: ConnState, message: string): Promise<void> {
    let raw: { event?: string; channel?: string; data?: unknown };
    try { raw = JSON.parse(message); } catch { return this.pusherError(state, 'invalid JSON'); }
    const event = raw.event;
    if (typeof event !== 'string') return this.pusherError(state, 'missing event');

    if (event === 'pusher:ping') {
      state.ws.send(JSON.stringify({ event: 'pusher:pong', data: '{}' }));
      return;
    }
    if (event === 'pusher:unsubscribe') {
      const d = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data as { channel?: string };
      const channel = d?.channel;
      if (channel && state.subs.delete(channel)) {
        this.channelIndex.get(channel)?.delete(state.connId);
        const att = state.ws.deserializeAttachment() as Attachment | null;
        this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
      }
      return;
    }
    if (event === 'pusher:subscribe') {
      const d = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
      const data = pusherSubscribeData.safeParse(d);
      if (!data.success) return this.pusherError(state, 'invalid subscribe data');
      const { channel, auth } = data.data;
      if (channel.startsWith('presence-')) return this.pusherError(state, 'presence channels are not supported');
      if (isPusherPrivateChannel(channel)) {
        if (!auth || !(await this.verifyChannelAuth(auth, channel, state.connId))) {
          return this.pusherError(state, `Could not find app for key ${channel.split('-')[0]}.`);
        }
      }
      if (state.subs.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION && !state.subs.has(channel)) {
        return this.pusherError(state, 'too many subscriptions');
      }
      state.subs.add(channel);
      let set = this.channelIndex.get(channel);
      if (!set) this.channelIndex.set(channel, (set = new Set()));
      set.add(state.connId);
      const att = state.ws.deserializeAttachment() as Attachment | null;
      this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
      state.ws.send(pusherFrame('pusher_internal:subscription_succeeded', channel, {}));
      return;
    }
    if (event.startsWith('client-')) {
      const channel = raw.channel;
      if (channel && isPusherPrivateChannel(channel) && state.subs.has(channel)) {
        const frame = pusherFrame(event, channel, raw.data);
        const targets = this.channelIndex.get(channel);
        if (targets) {
          for (const id of [...targets]) {
            if (id === state.connId) continue;
            const t = this.conns.get(id);
            if (!t) { targets.delete(id); continue; }
            try { t.ws.send(frame); } catch { this.dropConnection(t); }
          }
        }
      }
      return;
    }
  }

  private async handleSubscribe(state: ConnState, channel: string, requestId: string, auth?: string): Promise<void> {
    const fail = (code: string, message: string) =>
      state.ws.send(JSON.stringify({
        type: 'subscription.failed', requestId, channel,
        error: { code, message },
      }));

    if (channel.startsWith('presence:')) return fail('unsupported', 'presence channels are not supported');
    if (isPrivateChannel(channel)) {
      const att = state.ws.deserializeAttachment() as Attachment | null;
      const claimed = !!att && att.allowed.includes(channel);
      if (auth) {
        const secret = await this.appSecretKey();
        const idx = auth.indexOf(':');
        const sig = idx === -1 ? '' : auth.slice(idx + 1);
        const { hmacSha256 } = await import('../auth');
        const expected = secret ? await hmacSha256(secret, `${state.connId}:${channel}`) : '';
        const ok = secret !== null && sig.length > 0 && sig.toLowerCase() === expected;
        if (!ok) return fail('auth_failed', 'bad channel auth signature');
      } else if (!claimed) {
        return fail('forbidden', 'channel not allowed by token');
      }
    }
    if (state.subs.has(channel)) {
      state.ws.send(JSON.stringify({ type: 'subscription.succeeded', requestId, channel }));
      return;
    }
    if (state.subs.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) return fail('limit', 'too many subscriptions');

    state.subs.add(channel);
    let set = this.channelIndex.get(channel);
    if (!set) this.channelIndex.set(channel, (set = new Set()));
    set.add(state.connId);
    const att = state.ws.deserializeAttachment() as Attachment | null;
    this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
    state.ws.send(JSON.stringify({ type: 'subscription.succeeded', requestId, channel }));
  }

  private handleUnsubscribe(state: ConnState, channel: string, requestId: string): void {
    state.subs.delete(channel);
    this.channelIndex.get(channel)?.delete(state.connId);
    const att = state.ws.deserializeAttachment() as Attachment | null;
    this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
    state.ws.send(JSON.stringify({ type: 'subscription.succeeded', requestId, channel, op: 'unsubscribe' }));
  }

  async publishEvent(channel: string, event: string, data: unknown, excludeConnId?: string): Promise<{ eventId: string; delivered: number }> {
    this.ensureIndex();
    const now = Date.now();
    this.publishWindow = this.publishWindow.filter((t) => now - t < 60_000);
    if (this.publishWindow.length >= PUBLISH_LIMIT_PER_MINUTE) {
      throw new Error('rate_limited');
    }
    this.publishWindow.push(now);

    const eventId = `evt_${crypto.randomUUID()}`;
    const rthFrame = JSON.stringify({ type: 'event', eventId, channel, event, data });
    const pusherEventFrame = pusherFrame(event, channel, data);
    const targets = this.channelIndex.get(channel);
    let delivered = 0;
    if (targets) {
      for (const connId of [...targets]) {
        if (connId === excludeConnId) continue;
        const state = this.conns.get(connId);
        if (!state) { targets.delete(connId); continue; }
        try {
          state.ws.send(state.mode === 'pusher' ? pusherEventFrame : rthFrame);
          delivered++;
        } catch {
          this.dropConnection(state);
        }
      }
    }
    return { eventId, delivered };
  }

  async channelInfo(): Promise<Record<string, number>> {
    this.ensureIndex();
    const out: Record<string, number> = {};
    for (const [ch, set] of this.channelIndex) out[ch] = set.size;
    return out;
  }

  private dropConnection(state: ConnState): void {
    for (const ch of state.subs) this.channelIndex.get(ch)?.delete(state.connId);
    state.subs.clear();
    this.conns.delete(state.connId);
    try { state.ws.close(1011, 'slow consumer'); } catch { /* already closed */ }
  }

  async disconnectAll(reason: string): Promise<{ closed: number }> {
    this.ensureIndex();
    let closed = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.close(4001, reason); closed++; } catch { /* ignore */ }
    }
    this.conns.clear();
    this.channelIndex.clear();
    this.indexBuilt = false;
    return { closed };
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.ensureIndex();
    const connId = this.connIdFor(ws);
    const state = this.conns.get(connId);
    if (state) {
      for (const ch of state.subs) this.channelIndex.get(ch)?.delete(connId);
      this.conns.delete(connId);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
