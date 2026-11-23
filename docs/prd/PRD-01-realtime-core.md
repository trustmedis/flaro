# PRD 01: Realtime Core

**Product:** Realtime Hub  
**Version:** 1.0  
**Priority:** P0  
**Status:** Proposed

## 1. Overview

Realtime Hub is an internal publish/subscribe service built entirely on Cloudflare Workers and Durable Objects. It lets backend applications broadcast ephemeral events to connected clients without operating a WebSocket server.

## 2. Goals

1. Support realtime server-to-client communication.
2. Support multiple channel subscriptions over a single WebSocket.
3. Isolate applications from one another.
4. Minimize idle connection cost with WebSocket Hibernation.
5. Keep the wire protocol independent of Durable Object implementation details.

## 3. Non-Goals

- Pusher wire-protocol compatibility.
- Peer-to-peer messaging, persistent chat, replay, guaranteed delivery.
- Cross-application subscriptions, channel sharding, binary payloads.
- Client-triggered application events.

## 4. Architecture

**One application-based Durable Object per application, initially.** Each object owns all WebSocket connections and channels for one application. A connection can subscribe to multiple channels. This is deliberately simple but can become a hotspot at high throughput.

- Worker: WebSocket upgrades, authentication, validation, HTTP publish API.
- Application DO: WebSocket handling, subscription index, broadcasts, resource limits.
- D1: No reads required on the per-event fan-out hot path.

### Connection lifecycle

1. Client requests a WebSocket upgrade at `GET /v1/connect`.
2. Worker authenticates the connection and identifies its application.
3. Worker routes to the application DO.
4. DO accepts the connection with the Hibernation API.
5. Client sends subscribe requests; DO validates claims.
6. DO distributes published events to matching subscribers.

WebSocket attachments must contain sufficient serializable metadata to rebuild the in-memory subscription index after hibernation. Any additional live bookkeeping must be reconstructible.

### Publish lifecycle

1. Backend calls `POST /v1/apps/:appId/events`.
2. Worker authenticates publisher and validates payload.
3. Worker invokes the corresponding application DO via RPC.
4. DO fans out to active subscribers.
5. Worker responds with the outcome of processing the publish request.

An accepted publish does **not** imply that every client received or processed it.

## 5. Functional Requirements

### FR-01: Connections

- Authenticated WebSocket connections only.
- Unique connection ID issued by server.
- One connection may subscribe to multiple channels.
- Server may close sockets for authentication, policy, or overload reasons.

### FR-02: Subscriptions

Channel namespace:

- `public:<name>`
- `private:<name>`
- `presence:<name>` (reserved for later implementation)

MVP supports public and private channels. Defaults, configurable per application:

- Up to 100 subscriptions per connection.
- Up to 128 characters per channel name.
- Up to 64 KiB event payload.
- Up to 256 KiB serialized attachment metadata per connection (product-level guardrail; verify actual platform limits).

### FR-03: Publishing

`POST /v1/apps/:appId/events`

```json
{
  "channel": "private:patient-123",
  "event": "patient.updated",
  "data": { "patientId": "123", "status": "completed" }
}
```

Response:

```json
{ "eventId": "evt_01...", "accepted": true }
```

- JSON-serializable payload; unique event ID.
- Best-effort live delivery, no automatic storage or offline replay.
- Processing order is defined by the DO's actual sequencing; concurrent publisher requests do not have a guaranteed submission order.
- No cross-application delivery.

### FR-04: Wire protocol

Client subscribe:

```json
{ "type": "subscribe", "requestId": "req_1", "channel": "private:patient-123" }
```

Client unsubscribe:

```json
{ "type": "unsubscribe", "requestId": "req_2", "channel": "private:patient-123" }
```

Server event:

```json
{
  "type": "event",
  "eventId": "evt_01...",
  "channel": "private:patient-123",
  "event": "patient.updated",
  "data": { "status": "completed" }
}
```

Control messages: `connection.ready`, `subscription.succeeded`, `subscription.failed`, `connection.error`. Responses to requests include `requestId`.

### FR-05: Recovery

- Browser reconnects after network failure.
- New connection requires resubscription.
- Events during disconnection can be lost.
- Hibernation must not lose subscriptions on **still-active** sockets.

### FR-06: Resource protection

- Validate event names, channel names, payload size, subscription count.
- Rate limit publishing at the application DO.
- Avoid unbounded per-socket buffering; disconnect slow consumers.

## 6. Technology

TypeScript, Cloudflare Workers, Hono, Durable Objects, WebSocket Hibernation, DO RPC, Zod.

## 7. Acceptance Criteria

- [ ] Two subscribers on the same channel receive a published event.
- [ ] Different channels and applications are isolated.
- [ ] One connection can subscribe to multiple channels.
- [ ] Unsubscribe stops delivery.
- [ ] Repeated subscribe requests do not double-deliver events.
- [ ] Invalid events return structured errors.
- [ ] Subscriptions survive DO hibernation while socket remains connected.
- [ ] Publishing without subscribers succeeds.
- [ ] Slow consumers do not cause unbounded buffering.
- [ ] Integration tests run using Cloudflare Workers runtime.

## 8. Dependencies

PRD 02 (auth), PRD 03 (SDK).

## 9. Definition of Done

All acceptance criteria are covered by repeatable integration tests; no external message broker required.
