import { clientMessage, isPrivateChannel, isPusherPrivateChannel, jsonValue, MAX_SUBSCRIPTIONS_PER_CONNECTION, PROTOCOL_VERSION, pusherChannelData, pusherClientFrame, pusherFrame, pusherSubscribeData, pusherUnsubscribeData, subscriberTokenClaims } from '@internal/realtime-protocol';
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { JsonValue } from '@internal/realtime-protocol';

interface Attachment {
  v: 1;
  connId: string;
  appId: string;
  subs: Array<string>;
  allowed: Array<string>;
  sub: string;
  mode?: 'pusher';
  members?: Record<string, { id: string; info: unknown }>;
  connectedAt?: number;
  host?: string;
  userAgent?: string;
}

function isAttachment(value: unknown): value is Attachment {
  return typeof value === 'object' && value !== null && 'v' in value && value.v === 1;
}

function readAttachment(ws: WebSocket): Attachment | null {
  const value: unknown = ws.deserializeAttachment();
  return isAttachment(value) ? value : null;
}

function tryParseJson(value: string): JsonValue | undefined {
  try {
    const parsed = jsonValue.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch { return undefined; }
}

interface ConnState {
  ws: WebSocket;
  connId: string;
  subs: Set<string>;
  mode: 'rth' | 'pusher';
  lastOp: Map<string, 'sub' | 'unsub'>;
  connectedAt: number;
  host: string;
  userAgent: string;
  members?: Map<string, { id: string; info: unknown }>;
}

function clientHost(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? '';
}

interface PresenceMember {
  info: unknown;
  conns: Set<string>;
}

const PUBLISH_LIMIT_PER_MINUTE = 600;
const MAX_ATTACHMENT_BYTES = 200 * 1024;
const TIMELINE_MINUTES = 60;
const TIMELINE_WINDOW_MS = TIMELINE_MINUTES * 60_000;

function minuteBuckets(timestamps: Array<number>, now: number): Array<number> {
  const buckets = new Array<number>(TIMELINE_MINUTES).fill(0);
  for (const t of timestamps) {
    const idx = Math.floor((now - t) / 60_000);
    if (idx >= 0 && idx < TIMELINE_MINUTES) {
      buckets[TIMELINE_MINUTES - 1 - idx] = (buckets[TIMELINE_MINUTES - 1 - idx] ?? 0) + 1;
    }
  }
  return buckets;
}

interface TimedCount { t: number; n: number }

function minuteSums(entries: Array<TimedCount>, now: number): Array<number> {
  const buckets = new Array<number>(TIMELINE_MINUTES).fill(0);
  for (const e of entries) {
    const idx = Math.floor((now - e.t) / 60_000);
    if (idx >= 0 && idx < TIMELINE_MINUTES) {
      buckets[TIMELINE_MINUTES - 1 - idx] = (buckets[TIMELINE_MINUTES - 1 - idx] ?? 0) + e.n;
    }
  }
  return buckets;
}

export class ApplicationDO extends DurableObject<Env> {
  private indexBuilt = false;
  private conns = new Map<string, ConnState>();
  private channelIndex = new Map<string, Set<string>>();
  private presenceIndex = new Map<string, Map<string, PresenceMember>>();
  private publishWindow: Array<number> = [];
  private connectWindow: Array<number> = [];
  private disconnectWindow: Array<number> = [];
  private subscribeWindow: Array<number> = [];
  private bytesIn: Array<TimedCount> = [];
  private bytesOut: Array<TimedCount> = [];
  private deliveredWindow: Array<TimedCount> = [];

  private send(ws: WebSocket, payload: string): void {
    this.bytesOut.push({ t: Date.now(), n: payload.length });
    ws.send(payload);
  }

  private connIdFor(ws: WebSocket): string {
    return readAttachment(ws)?.connId ?? '';
  }

  private ensureIndex(): void {
    if (this.indexBuilt) {return;}
    this.indexBuilt = true;
    this.conns.clear();
    this.channelIndex.clear();
    this.presenceIndex.clear();
    for (const ws of this.ctx.getWebSockets()) {
      const att = readAttachment(ws);
      if (!att) {continue;}
      if (!this.appId && att.appId) {this.appId = att.appId;}
      const state: ConnState = {
        ws, connId: att.connId, subs: new Set(att.subs), mode: att.mode ?? 'rth', lastOp: new Map(),
        connectedAt: att.connectedAt ?? 0, host: att.host ?? '', userAgent: att.userAgent ?? '',
      };
      if (att.members) {state.members = new Map(Object.entries(att.members));}
      this.conns.set(att.connId, state);
      for (const ch of att.subs) {
        let set = this.channelIndex.get(ch);
        if (!set) {this.channelIndex.set(ch, (set = new Set<string>()));}
        set.add(att.connId);
      }
      if (state.members) {
        for (const [ch, member] of state.members) {
          let chan = this.presenceIndex.get(ch);
          if (!chan) {this.presenceIndex.set(ch, (chan = new Map<string, PresenceMember>()));}
          let entry = chan.get(member.id);
          if (!entry) {chan.set(member.id, (entry = { info: member.info, conns: new Set() }));}
          entry.conns.add(att.connId);
        }
      }
    }
  }

  private appId: string | null = null;

  private async appSecretKey(): Promise<string | null> {
    if (!this.appId) {return null;}
    const { drizzle } = await import('drizzle-orm/d1');
    const { applications } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const rows = await drizzle(this.env.DB).select({ s: applications.tokenSecret }).from(applications).where(eq(applications.id, this.appId)).limit(1);
    return rows[0]?.s ?? null;
  }

  private persistAttachment(state: ConnState, allowed: Array<string>, sub: string, appId?: string): void {
    const att: Attachment = {
      v: 1, connId: state.connId, appId: appId ?? this.appId ?? '', subs: [...state.subs], allowed, sub,
      connectedAt: state.connectedAt, host: state.host, userAgent: state.userAgent,
    };
    if (state.mode === 'pusher') {att.mode = 'pusher';}
    if (state.members?.size) {att.members = Object.fromEntries(state.members);}
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
      const client = pair[0];
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      // Pusher socket ids look like "1234.5678"; pusher server-side libraries
      // validate the format before signing channel auth.
      let connId: string;
      do {
        const r = crypto.getRandomValues(new Uint32Array(2));
        connId = `${r[0]}.${r[1]}`;
      } while (this.conns.has(connId));
      const state: ConnState = {
        ws: server, connId, subs: new Set(), mode: 'pusher', lastOp: new Map(),
        connectedAt: Date.now(), host: clientHost(request), userAgent: request.headers.get('user-agent') ?? '',
      };
      this.conns.set(connId, state);
      this.connectWindow.push(Date.now());
      this.indexBuilt = true;
      this.appId = appId;
      this.persistAttachment(state, [], '', appId);
      this.send(server, JSON.stringify({ event: 'pusher:connection_established', data: JSON.stringify({ socket_id: connId, activity_timeout: 120 }) }));
      return new Response(null, { status: 101, webSocket: client });
    }

    const claims = request.headers.get('x-rth-claims') ?? '';
    const parsed = subscriberTokenClaims.safeParse(tryParseJson(claims));
    if (!parsed.success) {return new Response('missing claims', { status: 401 });}

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    const connId = `conn_${crypto.randomUUID()}`;
    const state: ConnState = {
      ws: server, connId, subs: new Set(), mode: 'rth', lastOp: new Map(),
      connectedAt: Date.now(), host: clientHost(request), userAgent: request.headers.get('user-agent') ?? '',
    };
    this.conns.set(connId, state);
    this.connectWindow.push(Date.now());
    this.indexBuilt = true;
    this.appId = parsed.data.appId;
    this.persistAttachment(state, parsed.data.channels, parsed.data.sub, parsed.data.appId);

    this.send(server, JSON.stringify({
      type: 'connection.ready',
      connectionId: connId,
      protocol: PROTOCOL_VERSION,
    }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.ensureIndex();
    this.bytesIn.push({ t: Date.now(), n: typeof message === 'string' ? message.length : message.byteLength });
    if (typeof message !== 'string') {
      this.send(ws, JSON.stringify({ type: 'connection.error', error: { code: 'invalid_message', message: 'text frames only' } }));
      return;
    }
    const connId = this.connIdFor(ws);
    const state = this.conns.get(connId);
    if (!state) {return;}
    if (state.mode === 'pusher') {return this.handlePusherMessage(state, message);}

    let raw: unknown;
    try { raw = JSON.parse(message); } catch {
      this.send(ws, JSON.stringify({ type: 'connection.error', error: { code: 'invalid_json', message: 'frame is not JSON' } }));
      return;
    }
    const parsed = clientMessage.safeParse(raw);
    if (!parsed.success) {
      this.send(ws, JSON.stringify({ type: 'connection.error', error: { code: 'invalid_message', message: 'unrecognized message' } }));
      return;
    }
    const msg = parsed.data;

    if (msg.type === 'subscribe') {await this.handleSubscribe(state, msg.channel, msg.requestId, msg.auth);}
    else {this.handleUnsubscribe(state, msg.channel, msg.requestId);}
  }

  private pusherError(state: ConnState, message: string): void {
    this.send(state.ws, JSON.stringify({ event: 'pusher:error', data: JSON.stringify({ code: null, message }) }));
  }

  private pusherSubscriptionError(state: ConnState, channel: string, message: string, status = 403): void {
    this.send(state.ws, JSON.stringify({
      event: 'pusher:subscription_error',
      channel,
      data: JSON.stringify({ type: 'AuthError', error: message, status }),
    }));
  }

  private async verifyChannelAuth(auth: string, channel: string, connId: string, channelData?: string): Promise<boolean> {
    const secret = await this.appSecretKey();
    if (!secret) {return false;}
    const idx = auth.indexOf(':');
    const key = idx === -1 ? '' : auth.slice(0, idx);
    const sig = idx === -1 ? '' : auth.slice(idx + 1);
    if (key !== this.appId) {return false;}
    const base = channelData !== undefined ? `${connId}:${channel}:${channelData}` : `${connId}:${channel}`;
    const { hmacSha256 } = await import('../auth');
    const expected = await hmacSha256(secret, base);
    return sig.length > 0 && sig.toLowerCase() === expected;
  }

  private async handlePusherMessage(state: ConnState, message: string): Promise<void> {
    const parsed = pusherClientFrame.safeParse(tryParseJson(message));
    if (!parsed.success) {return this.pusherError(state, 'invalid JSON');}
    const { event, channel: frameChannel, data } = parsed.data;
    if (typeof event !== 'string') {return this.pusherError(state, 'missing event');}

    if (event === 'pusher:ping') {
      this.send(state.ws, JSON.stringify({ event: 'pusher:pong', data: '{}' }));
      return;
    }
    if (event === 'pusher:unsubscribe') {
      const d = pusherUnsubscribeData.safeParse(typeof data === 'string' ? tryParseJson(data) : data);
      if (d.success) {
        const channel = d.data.channel;
        state.lastOp.set(channel, 'unsub');
        if (state.subs.delete(channel)) {
          this.channelIndex.get(channel)?.delete(state.connId);
          this.removePresenceMember(state, channel);
          const att = readAttachment(state.ws);
          this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
        }
      }
      return;
    }
    if (event === 'pusher:subscribe') {
      const d = typeof data === 'string' ? tryParseJson(data) : data;
      const sub = pusherSubscribeData.safeParse(d);
      if (!sub.success) {return this.pusherError(state, 'invalid subscribe data');}
      const { channel, auth, channel_data } = sub.data;
      state.lastOp.set(channel, 'sub');

      if (state.subs.has(channel)) {
        return this.send(state.ws, this.subscriptionSucceededFrame(state, channel));
      }
      const isPresence = channel.startsWith('presence-');
      if (isPusherPrivateChannel(channel)) {
        if (!auth || !(await this.verifyChannelAuth(auth, channel, state.connId, channel_data))) {
          return this.pusherSubscriptionError(state, channel, 'Auth for subscription failed');
        }
        if (this.conns.get(state.connId) !== state || state.lastOp.get(channel) !== 'sub') {return;}
      }
      let member: { id: string; info: unknown } | undefined;
      if (isPresence) {
        if (!channel_data) {return this.pusherSubscriptionError(state, channel, 'channel_data is required for presence channels', 400);}
        try {
          const parsed = pusherChannelData.safeParse(JSON.parse(channel_data));
          if (!parsed.success) {return this.pusherSubscriptionError(state, channel, 'invalid channel_data', 400);}
          member = { id: parsed.data.user_id, info: parsed.data.user_info };
        } catch {
          return this.pusherSubscriptionError(state, channel, 'invalid channel_data', 400);
        }
      }
      if (state.subs.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION && !state.subs.has(channel)) {
        return this.pusherError(state, 'too many subscriptions');
      }
      state.subs.add(channel);
      this.subscribeWindow.push(Date.now());
      let set = this.channelIndex.get(channel);
      if (!set) {this.channelIndex.set(channel, (set = new Set<string>()));}
      set.add(state.connId);
      if (member) {this.addPresenceMember(state, channel, member);}
      const att = readAttachment(state.ws);
      this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
      this.send(state.ws, this.subscriptionSucceededFrame(state, channel));
      return;
    }
    if (event.startsWith('client-')) {
      if (typeof frameChannel === 'string' && isPusherPrivateChannel(frameChannel) && state.subs.has(frameChannel)) {
        const member = state.members?.get(frameChannel);
        const frame = member
          ? JSON.stringify({ event, channel: frameChannel, user_id: member.id, data: JSON.stringify(data ?? {}) })
          : pusherFrame(event, frameChannel, data);
        const targets = this.channelIndex.get(frameChannel);
        if (targets) {
          for (const id of targets) {
            if (id === state.connId) {continue;}
            const t = this.conns.get(id);
            if (!t) { targets.delete(id); continue; }
            try { this.send(t.ws, frame); } catch { this.dropConnection(t); }
          }
        }
      }
      return;
    }
  }

  private subscriptionSucceededFrame(state: ConnState, channel: string): string {
    const member = state.members?.get(channel);
    if (!member) {return pusherFrame('pusher_internal:subscription_succeeded', channel, {});}
    const chan = this.presenceIndex.get(channel);
    const ids = [...(chan?.keys() ?? [])];
    const hash = Object.fromEntries(Array.from(chan?.entries() ?? [], ([uid, m]) => [uid, m.info] as const));
    return pusherFrame('pusher_internal:subscription_succeeded', channel, {
      presence: { ids, hash, count: ids.length },
    });
  }

  private addPresenceMember(state: ConnState, channel: string, member: { id: string; info: unknown }): void {
    state.members ??= new Map();
    state.members.set(channel, member);
    let chan = this.presenceIndex.get(channel);
    if (!chan) {this.presenceIndex.set(channel, (chan = new Map<string, PresenceMember>()));}
    const existing = chan.get(member.id);
    if (existing) {
      existing.conns.add(state.connId);
      return;
    }
    chan.set(member.id, { info: member.info, conns: new Set([state.connId]) });
    const frame = pusherFrame('pusher_internal:member_added', channel, { user_id: member.id, user_info: member.info });
    for (const id of this.channelIndex.get(channel) ?? []) {
      if (id === state.connId) {continue;}
      const t = this.conns.get(id);
      if (!t) {continue;}
      try { this.send(t.ws, frame); } catch { this.dropConnection(t); }
    }
  }

  private removePresenceMember(state: ConnState, channel: string): void {
    const member = state.members?.get(channel);
    if (!member) {return;}
    state.members?.delete(channel);
    const chan = this.presenceIndex.get(channel);
    const entry = chan?.get(member.id);
    if (!chan || !entry) {return;}
    entry.conns.delete(state.connId);
    if (entry.conns.size > 0) {return;}
    chan.delete(member.id);
    if (chan.size === 0) {this.presenceIndex.delete(channel);}
    const frame = pusherFrame('pusher_internal:member_removed', channel, { user_id: member.id });
    for (const id of this.channelIndex.get(channel) ?? []) {
      const t = this.conns.get(id);
      if (!t) {continue;}
      try { this.send(t.ws, frame); } catch { this.dropConnection(t); }
    }
  }

  private async handleSubscribe(state: ConnState, channel: string, requestId: string, auth?: string): Promise<void> {
    const fail = (code: string, message: string) =>
      this.send(state.ws, JSON.stringify({
        type: 'subscription.failed', requestId, channel,
        error: { code, message },
      }));

    state.lastOp.set(channel, 'sub');
    if (channel.startsWith('presence:')) {return fail('unsupported', 'presence channels are not supported');}
    if (isPrivateChannel(channel)) {
      const att = readAttachment(state.ws);
      const claimed = !!att && att.allowed.includes(channel);
      if (auth) {
        const secret = await this.appSecretKey();
        const idx = auth.indexOf(':');
        const sig = idx === -1 ? '' : auth.slice(idx + 1);
        const { hmacSha256 } = await import('../auth');
        const expected = secret ? await hmacSha256(secret, `${state.connId}:${channel}`) : '';
        const ok = secret !== null && sig.length > 0 && sig.toLowerCase() === expected;
        if (!ok) {return fail('auth_failed', 'bad channel auth signature');}
      } else if (!claimed) {
        return fail('forbidden', 'channel not allowed by token');
      }
      if (this.conns.get(state.connId) !== state || state.lastOp.get(channel) !== 'sub') {
        return fail('superseded', 'request superseded by a newer one');
      }
    }
    if (state.subs.has(channel)) {
      this.send(state.ws, JSON.stringify({ type: 'subscription.succeeded', requestId, channel }));
      return;
    }
    if (state.subs.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {return fail('limit', 'too many subscriptions');}

    state.subs.add(channel);
    this.subscribeWindow.push(Date.now());
    let set = this.channelIndex.get(channel);
    if (!set) {this.channelIndex.set(channel, (set = new Set<string>()));}
    set.add(state.connId);
    const att = readAttachment(state.ws);
    this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
    this.send(state.ws, JSON.stringify({ type: 'subscription.succeeded', requestId, channel }));
  }

  private handleUnsubscribe(state: ConnState, channel: string, requestId: string): void {
    state.lastOp.set(channel, 'unsub');
    state.subs.delete(channel);
    this.channelIndex.get(channel)?.delete(state.connId);
    const att = readAttachment(state.ws);
    this.persistAttachment(state, att?.allowed ?? [], att?.sub ?? '');
    this.send(state.ws, JSON.stringify({ type: 'subscription.succeeded', requestId, channel, op: 'unsubscribe' }));
  }

  async publishEvent(channel: string, event: string, data: unknown, excludeConnId?: string): Promise<{ eventId: string; delivered: number }> {
    this.ensureIndex();
    const now = Date.now();
    this.publishWindow = this.publishWindow.filter((t) => now - t < TIMELINE_WINDOW_MS);
    if (this.publishWindow.reduce((n, t) => (now - t < 60_000 ? n + 1 : n), 0) >= PUBLISH_LIMIT_PER_MINUTE) {
      throw new Error('rate_limited');
    }
    this.publishWindow.push(now);
    this.bytesIn.push({ t: now, n: JSON.stringify(data).length });

    const eventId = `evt_${crypto.randomUUID()}`;
    const rthFrame = JSON.stringify({ type: 'event', eventId, channel, event, data });
    const pusherEventFrame = pusherFrame(event, channel, data);
    const targets = this.channelIndex.get(channel);
    let delivered = 0;
    if (targets) {
      for (const connId of targets) {
        if (connId === excludeConnId) {continue;}
        const state = this.conns.get(connId);
        if (!state) { targets.delete(connId); continue; }
        try {
          this.send(state.ws, state.mode === 'pusher' ? pusherEventFrame : rthFrame);
          delivered++;
        } catch {
          this.dropConnection(state);
        }
      }
    }
    this.deliveredWindow.push({ t: now, n: delivered });
    return { eventId, delivered };
  }

  async channelInfo(): Promise<Record<string, number>> {
    this.ensureIndex();
    const out: Record<string, number> = {};
    for (const [ch, set] of this.channelIndex) {out[ch] = set.size;}
    return out;
  }

  async stats(): Promise<{
    bandwidthInTimeline: Array<number>; bandwidthOutTimeline: Array<number>;
    channels: number; connections: number; connectionsTimeline: Array<number>;
    deliveredTimeline: Array<number>; disconnectionsTimeline: Array<number>;
    eventsPerMinute: number; eventsTimeline: Array<number>; presenceMembers: number;
    subscribers: number; subscriptionsTimeline: Array<number>;
  }> {
    this.ensureIndex();
    const now = Date.now();
    const fresh = (e: { t: number } | number): boolean => now - (typeof e === 'number' ? e : e.t) < TIMELINE_WINDOW_MS;
    this.publishWindow = this.publishWindow.filter(fresh);
    this.connectWindow = this.connectWindow.filter(fresh);
    this.disconnectWindow = this.disconnectWindow.filter(fresh);
    this.subscribeWindow = this.subscribeWindow.filter(fresh);
    this.bytesIn = this.bytesIn.filter(fresh);
    this.bytesOut = this.bytesOut.filter(fresh);
    this.deliveredWindow = this.deliveredWindow.filter(fresh);
    let subscribers = 0;
    for (const set of this.channelIndex.values()) {subscribers += set.size;}
    let presenceMembers = 0;
    for (const chan of this.presenceIndex.values()) {presenceMembers += chan.size;}
    const eventsTimeline = minuteBuckets(this.publishWindow, now);
    const connectionsTimeline = minuteBuckets(this.connectWindow, now);
    return {
      bandwidthInTimeline: minuteSums(this.bytesIn, now),
      bandwidthOutTimeline: minuteSums(this.bytesOut, now),
      channels: this.channelIndex.size,
      connections: this.conns.size,
      connectionsTimeline,
      deliveredTimeline: minuteSums(this.deliveredWindow, now),
      disconnectionsTimeline: minuteBuckets(this.disconnectWindow, now),
      eventsPerMinute: eventsTimeline[TIMELINE_MINUTES - 1] ?? 0,
      eventsTimeline,
      presenceMembers,
      subscribers,
      subscriptionsTimeline: minuteBuckets(this.subscribeWindow, now),
    };
  }

  async connections(): Promise<Array<{
    channels: Array<string>; connId: string; connectedAt: number;
    host: string; mode: string; sub: string; userAgent: string;
  }>> {
    this.ensureIndex();
    return [...this.conns.values()].map((state) => ({
      channels: [...state.subs],
      connId: state.connId,
      connectedAt: state.connectedAt,
      host: state.host,
      mode: state.mode,
      sub: readAttachment(state.ws)?.sub ?? '',
      userAgent: state.userAgent,
    }));
  }

  async channels(): Promise<Array<{ name: string; subscribers: number }>> {
    this.ensureIndex();
    return [...this.channelIndex].map(([name, set]) => ({ name, subscribers: set.size }));
  }

  private dropConnection(state: ConnState): void {
    for (const ch of state.subs) {
      this.channelIndex.get(ch)?.delete(state.connId);
      this.removePresenceMember(state, ch);
    }
    state.subs.clear();
    if (this.conns.delete(state.connId)) {this.disconnectWindow.push(Date.now());}
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
    this.presenceIndex.clear();
    this.indexBuilt = false;
    return { closed };
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.ensureIndex();
    const connId = this.connIdFor(ws);
    const state = this.conns.get(connId);
    if (state) {
      for (const ch of state.subs) {
        this.channelIndex.get(ch)?.delete(connId);
        this.removePresenceMember(state, ch);
      }
      this.conns.delete(connId);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
