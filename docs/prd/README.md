# Realtime Hub: Internal Realtime Infrastructure

A Cloudflare-native, internal-only realtime publish/subscribe service.

## Documents

1. [PRD 01: Realtime Core](./PRD-01-realtime-core.md) (P0)
2. [PRD 02: Authentication & Application Management](./PRD-02-auth-application-management.md) (P0)
3. [PRD 03: TypeScript SDK & Developer Experience](./PRD-03-sdk-developer-experience.md) (P0)
4. [PRD 04: Observability, Reliability & Operations](./PRD-04-observability-reliability.md) (P1)

## Architecture decisions

| Concern | Decision |
| --- | --- |
| Runtime | Cloudflare Workers |
| HTTP framework | Hono |
| Realtime engine | Durable Objects + WebSocket Hibernation |
| Durable Object layout | One DO per application initially |
| Connection model | One WebSocket per application/client, multiplexed subscriptions |
| Control plane database | Cloudflare D1 + Drizzle |
| Events | Ephemeral, best-effort delivery; backend is source of truth |
| Metrics | Workers Analytics Engine + Cloudflare Logs and Traces |
| SDK | TypeScript browser and server |
| Public Pusher protocol | Not required |
| Billing, public dashboard, Redis, Kafka | Out of scope |
| Asynchronous queues | Not needed for MVP |

## Milestones

- **Milestone 1: Functional MVP**: PRD 01 + minimum authentication from PRD 02.
- **Milestone 2: Integration**: Complete PRD 02 and PRD 03.
- **Milestone 3: Production readiness**: PRD 04 and benchmark results.
- **Later, only if necessary**: Presence membership, replay, DO sharding, framework-specific SDK wrappers.

## System assumptions

- This is for trusted internal applications, *not* a commercial multi-tenant Pusher competitor.
- Each application retains its own authoritative business data.
- Lost events on disconnected browsers are acceptable; applications refetch current state on reconnection.
- Clients do not publish application events directly.
- Healthcare payloads should contain minimal identifiers/status, never full patient records.

## Open engineering validations

1. Verify Cloudflare DO CPU/memory behavior at the intended peak connections and fan-out rates.
2. Benchmark hibernation/wake-up with subscription state restored from WebSocket attachments.
3. Confirm token validation, revocation, and how auth changes affect already-open WebSockets.
4. Assess D1 metadata and Analytics Engine metrics retention and query needs.

