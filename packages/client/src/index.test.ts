import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeClient } from './index';

const READY = { type: 'connection.ready', connectionId: 'conn_1', protocol: 1 };

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  static latest(): FakeWebSocket {
    return this.instances[this.instances.length - 1]!;
  }
  readyState = 0;
  readonly url: string;
  sent: string[] = [];
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  }
  removeEventListener(type: string, fn: (e: unknown) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  send(data: string) {
    this.sent.push(data);
    const msg = JSON.parse(data);
    if (msg.type === 'subscribe') {
      queueMicrotask(() =>
        this.message({ type: 'subscription.succeeded', requestId: msg.requestId, channel: msg.channel }));
    }
  }
  close() {
    this.drop(1000);
  }
  // test drivers
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.fire('open', {});
  }
  message(data: unknown) {
    this.fire('message', { data: JSON.stringify(data) });
  }
  drop(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.fire('close', { code });
  }
  private fire(type: string, ev: unknown) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn(ev);
  }
}

const tick = () => vi.advanceTimersByTimeAsync(0);

function makeClient() {
  return new RealtimeClient({ url: 'http://test', appId: 'app_1', getToken: async () => 'tok' });
}

async function connectAndReady(client: RealtimeClient): Promise<FakeWebSocket> {
  const p = client.connect();
  await tick();
  await tick();
  const ws = FakeWebSocket.latest();
  ws.open();
  await tick(); // let the client's ready-listener attach (microtask boundary)
  ws.message(READY);
  await p;
  return ws;
}

describe('RealtimeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('resubscribes only channels the user still wants after reconnect', async () => {
    const client = makeClient();
    client.channel('handler-only').on('evt', () => {});
    client.channel('dropped');
    client.channel('wanted');
    const ws1 = await connectAndReady(client);

    await client.subscribeChannel('dropped');
    await client.subscribeChannel('wanted');
    await client.unsubscribeChannel('dropped');

    ws1.drop();
    await vi.advanceTimersByTimeAsync(1_500); // fire the reconnect timer
    await tick();
    const ws2 = FakeWebSocket.latest();
    expect(ws2).not.toBe(ws1);
    ws2.open();
    await tick();
    ws2.message(READY);
    await tick();
    await tick();
    await tick();

    const subs = ws2.sent
      .map((f) => JSON.parse(f))
      .filter((m) => m.type === 'subscribe')
      .map((m) => m.channel);
    expect(subs).toEqual(['wanted']);
  });

  it('a manual connect during reconnect backoff does not open a second socket', async () => {
    const client = makeClient();
    const ws1 = await connectAndReady(client);
    ws1.drop();

    await vi.advanceTimersByTimeAsync(1_500); // timer fires → connect() starts attempt
    await tick();
    const ws2 = FakeWebSocket.latest();
    expect(ws2).not.toBe(ws1);

    const manual = client.connect(); // must join the in-flight attempt
    await tick();
    ws2.open();
    await tick();
    ws2.message(READY);
    await manual;

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.state).toBe('connected');
  });
});
