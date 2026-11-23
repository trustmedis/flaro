# PRD 03: TypeScript SDK & Developer Experience

**Product:** Realtime Hub  
**Version:** 1.0  
**Priority:** P0  
**Status:** Proposed

## 1. Overview

Framework-agnostic TypeScript browser and server SDKs that hide WebSocket connection management, subscription lifecycle, and HTTP publishing complexity.

## 2. Goals

- Make existing apps integrate realtime with minimal code.
- Support browser and Node.js/Workers publisher environments.
- Reconnect and resubscribe automatically.
- Enable typed event handlers.
- Publish concise, actionable integration docs.

## 3. Packages

- `@internal/realtime-client`: Browser SDK.
- `@internal/realtime-server`: Trusted backend publisher SDK.
- `@internal/realtime-protocol`: Shared schemas and message types, no Cloudflare runtime dependency.

## 4. Browser SDK

```ts
import { RealtimeClient } from '@internal/realtime-client';

const realtime = new RealtimeClient({
  url: 'wss://realtime.example.com',
  appId: 'hospital-app',
  getToken: async () => {
    const response = await fetch('/api/realtime/token');
    if (!response.ok) throw new Error('Token unavailable');
    return (await response.json()).token;
  },
});

const channel = realtime.channel('private:patient-123');
const off = channel.on('patient.updated', payload => console.log(payload));

await realtime.connect();
await channel.subscribe();

// Cleanup:
off();
await channel.unsubscribe();
await realtime.disconnect();
```

## 5. Functional Requirements

### FR-01: State machine

States: `idle`, `connecting`, `connected`, `reconnecting`, `disconnected`, `failed`. State transitions are observable.

### FR-02: Reconnect

- Exponential backoff + jitter, configurable maximum delay.
- No parallel reconnect attempts.
- Refresh token before re-establishing connection.
- Do not endlessly retry permanent auth failures.
- Explicit disconnect prevents reconnect.

### FR-03: Resubscribe

Reconnect obtains a new connection, restores desired subscriptions, awaits subscription acknowledgments, and resumes dispatch. There is no offline replay guarantee.

### FR-04: Subscriptions

- Idempotent subscribe and unsubscribe.
- Correlated subscribe acknowledgments and structured errors.
- Multiple event handlers per channel.
- Listener cleanup without leaks.

### FR-05: Typed event map

```ts
type Events = {
  'patient.updated': { patientId: string; status: string };
  'job.completed': { jobId: string; resultUrl: string };
};
```

Compile-time types do not imply runtime validation. Consumers may supply Zod schemas.

### FR-06: Deduplication

Optional bounded LRU deduplication by `eventId`. This does not guarantee exactly-once delivery.

### FR-07: Server SDK

```ts
import { RealtimeServer } from '@internal/realtime-server';

const realtime = new RealtimeServer({
  baseUrl: 'https://realtime.example.com',
  appId: 'hospital-app',
  apiKey: process.env.REALTIME_API_KEY!,
});

await realtime.publish({
  channel: 'private:patient-123',
  event: 'patient.updated',
  data: { patientId: '123', status: 'completed' },
});
```

- Typed publishing, timeout, structured errors, request correlation IDs.
- Bounded retries available but **disabled by default** for publish to avoid accidental duplicate events.

### FR-08: Documentation

Quick start, publishing, private channel auth, connection recovery, errors, React integration example, and security practices.

### FR-09: Protocol versioning

Handshake identifies explicit protocol version. Incompatible versions produce a clear error.

## 6. Non-Goals

Pusher compatibility, dedicated React/Vue/Svelte packages, offline queue, mobile-native SDK, E2E encryption, event replay.

## 7. Acceptance Criteria

- [ ] Browser opens one WebSocket and subscribes to at least 10 channels.
- [ ] Events dispatch only to matching handlers.
- [ ] Unsubscribe and cleanup remove listeners.
- [ ] Network interruption triggers controlled reconnect.
- [ ] Reconnect refreshes auth token and resubscribes.
- [ ] Auth failures do not generate infinite retries.
- [ ] Explicit disconnect stops reconnection.
- [ ] Server SDK publishes from Node.js and Cloudflare Workers.
- [ ] Browser SDK has no Cloudflare-specific runtime dependency.

## 8. Definition of Done

An example app uses the published SDKs successfully, backed by integration tests for lifecycle, reconnection, permissions, and event dispatch.
