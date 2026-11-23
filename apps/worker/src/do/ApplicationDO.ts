import {
  clientMessage,
  isPrivateChannel,
  MAX_SUBSCRIPTIONS_PER_CONNECTION,
  PROTOCOL_VERSION,
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
}

interface ConnState {
  ws: WebSocket;
  connId: string;
  subs: Set<string>;
}

const PUBLISH_LIMIT_PER_MINUTE = 600;
const MAX_ATTACHMENT_BYTES = 200 * 1024;

export class ApplicationDO extends DurableObject<Env> {
  private indexBuilt = false;
  private conns = new Map<string, ConnState>();
  private channelIndex = new Map<string, Set<string>>();
  private publishWindow: number[] = [];
  private appSecret: string | null = null;

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
      const state: ConnState = { ws, connId: att.connId, subs: new Set(att.subs) };
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
    if (this.appSecret) return this.appSecret;
    if (!this.appId) return null;
    const { drizzle } = await import('drizzle-orm/d1');
    const { applications } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await drizzle(this.env.DB).select({ s: applications.tokenSecret }).from(applications).where(eq(applications.id, this.appId)).limit(1);
    this.appSecret = rows[0]?.s ?? null;
    return this.appSecret;
  }

  private persistAttachment(state: ConnState, allowed: string[], sub: string, appId?: string): void {
    const att: Attachment = { v: 1, connId: state.connId, appId: appId ?? this.appId ?? '', subs: [...state.subs], allowed, sub };
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
    const claims = (request.headers.get('x-rth-claims') ?? '') as string;
    let parsed: SubscriberTokenClaims | null = null;
    try { parsed = JSON.parse(claims); } catch { /* handled below */ }
    if (!parsed) return new Response('missing claims', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);

    const connId = `conn_${crypto.randomUUID()}`;
    const state: ConnState = { ws: server, connId, subs: new Set() };
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
    const connId = this.connIdFor(ws);
    const state = this.conns.get(connId);
    if (!state) return;

    if (msg.type === 'subscribe') await this.handleSubscribe(state, msg.channel, msg.requestId, msg.auth);
    else this.handleUnsubscribe(state, msg.channel, msg.requestId);
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

  async publishEvent(channel: string, event: string, data: unknown): Promise<{ eventId: string; delivered: number }> {
    this.ensureIndex();
    const now = Date.now();
    this.publishWindow = this.publishWindow.filter((t) => now - t < 60_000);
    if (this.publishWindow.length >= PUBLISH_LIMIT_PER_MINUTE) {
      throw new Error('rate_limited');
    }
    this.publishWindow.push(now);

    const eventId = `evt_${crypto.randomUUID()}`;
    const frame = JSON.stringify({ type: 'event', eventId, channel, event, data });
    const targets = this.channelIndex.get(channel);
    let delivered = 0;
    if (targets) {
      for (const connId of [...targets]) {
        const state = this.conns.get(connId);
        if (!state) { targets.delete(connId); continue; }
        try {
          state.ws.send(frame);
          delivered++;
        } catch {
          this.dropConnection(state);
        }
      }
    }
    return { eventId, delivered };
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
