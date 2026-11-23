import { serverMessage, type EventMessage } from '@internal/realtime-protocol';

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export interface RealtimeClientOptions {
  url: string;
  appId: string;
  getToken: () => Promise<string>;
  reconnect?: {
    maxDelayMs?: number;
    baseDelayMs?: number;
    maxAttempts?: number;
  };
}

interface ChannelRecord {
  name: string;
  subscribed: boolean;
  wanted: boolean;
}

export class Channel<TEvents extends Record<string, unknown> = Record<string, unknown>> {
  private client: RealtimeClient;
  readonly name: string;
  private handlers = new Map<string, Set<(data: never, ev: EventMessage) => void>>();
  subscribed = false;

  constructor(client: RealtimeClient, name: string) {
    this.client = client;
    this.name = name;
  }

  on<K extends keyof TEvents & string>(event: K, handler: (data: TEvents[K], ev: EventMessage) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    const wrapped = handler as (data: never, ev: EventMessage) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  async subscribe(): Promise<void> {
    return this.client.subscribeChannel(this.name);
  }

  async unsubscribe(): Promise<void> {
    return this.client.unsubscribeChannel(this.name);
  }

  dispatch(ev: EventMessage): void {
    const set = this.handlers.get(ev.event);
    if (!set) return;
    for (const h of [...set]) {
      try { h(ev.data as never, ev); } catch { /* listener errors must not break dispatch */ }
    }
  }

  get handlerCount(): number {
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  hasHandlers(): boolean {
    return this.handlerCount > 0;
  }
}

export class RealtimeClient {
  private opts: Required<Pick<RealtimeClientOptions, 'url' | 'appId' | 'getToken'>> & RealtimeClientOptions;
  private ws: WebSocket | null = null;
  private stateValue: ConnectionState = 'idle';
  private channels = new Map<string, ChannelRecord>();
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private reqCounter = 0;
  private pendingAcks = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private pendingSubscribes = new Map<string, Promise<void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private explicitDisconnect = false;
  private connectPromise: Promise<void> | null = null;

  constructor(opts: RealtimeClientOptions) {
    const url = opts.url.replace(/\/+$/, '');
    this.opts = {
      ...opts,
      url: url.startsWith('http://') ? `ws://${url.slice(7)}` : url.startsWith('https://') ? `wss://${url.slice(8)}` : url,
    };
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  onStateChange(fn: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  private setState(s: ConnectionState): void {
    if (this.stateValue === s) return;
    this.stateValue = s;
    for (const fn of [...this.stateListeners]) {
      try { fn(s); } catch { /* ignore */ }
    }
  }

  channel<T extends Record<string, unknown> = Record<string, unknown>>(name: string): Channel<T> {
    let rec = this.channels.get(name) as ChannelRecord | undefined;
    if (!rec) {
      rec = { name, subscribed: false, wanted: false };
      this.channels.set(name, rec);
    }
    const existing = (this as unknown as { _channelCache?: Map<string, Channel> })._channelCache;
    const cache = existing ?? ((this as unknown as { _channelCache: Map<string, Channel> })._channelCache = new Map());
    let ch = cache.get(name) as Channel<T> | undefined;
    if (!ch) {
      ch = new Channel<T>(this, name);
      cache.set(name, ch);
    }
    return ch;
  }

  async connect(): Promise<void> {
    if (this.ws && (this.stateValue === 'connected' || this.stateValue === 'connecting')) return;
    if (this.connectPromise) return this.connectPromise;
    this.explicitDisconnect = false;
    this.connectPromise = this.doConnect().finally(() => { this.connectPromise = null; });
    return this.connectPromise;
  }

  private async doConnect(): Promise<void> {
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    const token = await this.opts.getToken();
    const wsUrl = `${this.opts.url.replace(/\/+$/, '')}/v1/connect?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 10_000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('websocket error')); }, { once: true });
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ready timeout')), 10_000);
      const onMsg = (e: MessageEvent) => {
        try {
          const msg = serverMessage.parse(JSON.parse(String(e.data)));
          if (msg.type === 'connection.ready') { clearTimeout(timer); ws.removeEventListener('message', onMsg); resolve(); }
          else if (msg.type === 'connection.error') { clearTimeout(timer); ws.removeEventListener('message', onMsg); reject(new Error(msg.error.message)); }
        } catch { /* ignore non-matching frames during handshake */ }
      };
      ws.addEventListener('message', onMsg);
    });

    ws.addEventListener('message', (e) => this.onMessage(e));
    ws.addEventListener('close', () => this.onClose());
    ws.addEventListener('error', () => { /* close follows */ });

    this.setState('connected');
    this.reconnectAttempts = 0;
    await this.resubscribeAll();
  }

  private onMessage(e: MessageEvent): void {
    let msg;
    try { msg = serverMessage.parse(JSON.parse(String(e.data))); } catch { return; }
    if (msg.type === 'event') {
      const rec = this.channels.get(msg.channel);
      if (rec) {
        const ch = this.channelForRecord(rec);
        ch?.dispatch(msg);
      }
      return;
    }
    if (msg.type === 'subscription.succeeded' || msg.type === 'subscription.failed') {
      const pending = this.pendingAcks.get(msg.requestId);
      if (pending) {
        this.pendingAcks.delete(msg.requestId);
        const rec = this.channels.get(msg.channel);
        if (msg.type === 'subscription.succeeded') {
          if (rec) rec.subscribed = true;
          pending.resolve();
        } else {
          if (rec) rec.subscribed = false;
          pending.reject(new Error(msg.error.message));
        }
      }
      return;
    }
    if (msg.type === 'connection.error') {
      for (const [, p] of this.pendingAcks) p.reject(new Error(msg.error.message));
      this.pendingAcks.clear();
    }
  }

  private channelForRecord(rec: ChannelRecord): Channel | undefined {
    return (this as unknown as { _channelCache?: Map<string, Channel> })._channelCache?.get(rec.name);
  }

  private onClose(): void {
    this.ws = null;
    for (const rec of this.channels.values()) rec.subscribed = false;
    for (const [, p] of this.pendingAcks) p.reject(new Error('connection closed'));
    this.pendingAcks.clear();
    if (this.explicitDisconnect) {
      this.setState('disconnected');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    const maxAttempts = this.opts.reconnect?.maxAttempts ?? Infinity;
    if (this.reconnectAttempts >= maxAttempts) {
      this.setState('failed');
      return;
    }
    this.setState('reconnecting');
    const base = this.opts.reconnect?.baseDelayMs ?? 500;
    const max = this.opts.reconnect?.maxDelayMs ?? 30_000;
    const exp = Math.min(base * 2 ** this.reconnectAttempts, max);
    const jitter = exp * (0.5 + Math.random() * 0.5);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => this.onClose());
    }, jitter);
  }

  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('not connected');
    this.ws.send(JSON.stringify(msg));
  }

  private requestAck(channel: string, build: (requestId: string) => object, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const requestId = `req_${++this.reqCounter}`;
      const timer = setTimeout(() => {
        this.pendingAcks.delete(requestId);
        reject(new Error(`ack timeout for ${channel}`));
      }, timeoutMs);
      this.pendingAcks.set(requestId, {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.send(build(requestId));
      } catch (e) {
        clearTimeout(timer);
        this.pendingAcks.delete(requestId);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async subscribeChannel(name: string): Promise<void> {
    const rec = this.channels.get(name);
    if (!rec) throw new Error(`unknown channel ${name}; call channel() first`);
    rec.wanted = true;
    if (rec.subscribed) return;
    const existing = this.pendingSubscribes.get(name);
    if (existing) return existing;
    const p = (async () => {
      await this.ensureConnected();
      await this.requestAck(name, (requestId) => ({ type: 'subscribe', requestId, channel: name }));
      rec.subscribed = true;
    })();
    this.pendingSubscribes.set(name, p);
    try { await p; } finally { this.pendingSubscribes.delete(name); }
  }

  async unsubscribeChannel(name: string): Promise<void> {
    const rec = this.channels.get(name);
    if (!rec) return;
    rec.wanted = false;
    if (!rec.subscribed && !this.pendingSubscribes.has(name)) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { rec.subscribed = false; return; }
    this.send({ type: 'unsubscribe', requestId: `req_${++this.reqCounter}`, channel: name });
    rec.subscribed = false;
  }

  private async ensureConnected(): Promise<void> {
    if (this.stateValue === 'connected' && this.ws?.readyState === WebSocket.OPEN) return;
    if (this.stateValue === 'connecting' || this.stateValue === 'reconnecting') {
      await new Promise<void>((resolve, reject) => {
        const off = this.onStateChange((s) => {
          if (s === 'connected') { off(); resolve(); }
          if (s === 'failed' || s === 'disconnected') { off(); reject(new Error(`connection ${s}`)); }
        });
      });
      return;
    }
    await this.connect();
  }

  private async resubscribeAll(): Promise<void> {
    for (const [name, rec] of this.channels) {
      if (!rec.wanted || rec.subscribed || this.pendingSubscribes.has(name)) continue;
      try {
        await this.requestAck(name, (requestId) => ({ type: 'subscribe', requestId, channel: name }));
        rec.subscribed = true;
      } catch { /* individual resubscribe failure shouldn't kill the socket */ }
    }
  }

  async disconnect(): Promise<void> {
    this.explicitDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(1000, 'client disconnect'); } catch { /* ignore */ }
    for (const rec of this.channels.values()) rec.subscribed = false;
    this.setState('disconnected');
  }
}
