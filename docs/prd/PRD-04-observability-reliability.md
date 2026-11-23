# PRD 04: Observability, Reliability & Operations

**Product:** Realtime Hub  
**Version:** 1.0  
**Priority:** P1  
**Status:** Proposed

## 1. Overview

Establish operational visibility, performance limits, and failure-handling processes for the internal realtime service. Validate the practical capacity of one Durable Object per application before introducing distributed sharding.

## 2. Goals

- Measure connections, throughput, latency, and errors.
- Detect slow consumers and abnormal resource pressure.
- Produce repeatable benchmarks for hot application DOs.
- Support fast diagnosis and key revocation incidents.
- Define practical conditions that would justify a future sharded design.

## 3. Non-Goals

Public analytics dashboard, customer SLA, billing, event replay, active-active cross-region replication, or automatic sharding.

## 4. Observability

- **Workers Logs and Traces:** Upgrade/auth errors, request and RPC latency, exceptions.
- **Workers Analytics Engine:** Usage/latency metrics by application and environment.
- **D1:** Configuration and metadata only, not high-frequency telemetry.

### Required metrics

**Connections:** `connections_opened`, `connections_closed`, `connections_active`, `connection_duration_ms`, `connection_errors`.

**Messaging:** `messages_published`, `messages_fanout_attempted`, `messages_fanout_failed`, `publish_latency_ms`, `payload_bytes`.

**Subscriptions:** `subscriptions_created`, `subscriptions_removed`, `subscriptions_rejected`, `active_channels`.

**Resources:** DO errors, CPU, request counts, memory failures, invalid payloads, slow-consumer disconnects.

Never log message payloads, tokens, API keys, or patient health information.

## 5. Functional Requirements

### FR-01: Structured logs

Capture timestamp, request/correlation ID, application ID, operation, outcome, error code, and duration.

### FR-02: Health checks

`GET /health` checks API Worker availability, **not** all DOs. A separate synthetic publish-subscribe probe tests realtime operation.

### FR-03: Benchmarks

Run repeatable tests for:

- 100 / 500 / 1,000 simultaneous connections per application.
- 10,000 subscriptions across those connections.
- Fan-out to 100 / 500 / 1,000 subscribers.
- Small and medium JSON payloads.
- Publish bursts and reconnection storms.
- Hibernation/wake-up state reconstruction.
- Normal operation and connection churn.

Connections and subscriptions are different quantities: one connection may have many subscriptions.

### FR-04: Initial latency goals (to be validated)

- p95 server-side publish processing < 100 ms at nominal benchmark load.
- p95 end-to-end delivery < 300 ms within the same test geography.
- Reconnect and resubscribe < 5 seconds after stable network returns.
- Publish error rate < 0.1% at nominal load, excluding invalid requests.

These are engineering targets, **not** a public SLA. Report measurement methods and actual results.

### FR-05: Backpressure

Bound pending per-connection messages; disconnect slow consumers exceeding safe thresholds; log reason without logging data payloads.

### FR-06: Rate limits

Configurable limits for publish RPS, active connections per app, subscriptions per socket, and payload size. Consistent per-app limits belong in its application DO; Worker enforces coarse protection earlier in the path.

### FR-07: Failure semantics

- Failed/unknown publish operations return structured errors and correlation IDs.
- SDK does not assume a timeout implies an event was not broadcast.
- Reconnected clients resubscribe and refetch business state; dropped events are acceptable.

### FR-08: Alerts

Monitor elevated publish failures, WebSocket upgrade errors, sudden connection-count drops, auth spikes, and fan-out latency. Prefer native Cloudflare notification options. Use a scheduled Worker for custom checks only if needed.

### FR-09: Security operations

Document API key rotation, emergency app disable, audit lookup, sensitive-data logging policy, and incident response.

## 6. Sharding decision gate

Retain one DO per application while nominal workloads satisfy latency, error, memory, and CPU targets. If benchmarks fail, identify the bottleneck (serialization, CPU, memory, fan-out, or network) before designing connection-shard/channel-router DOs.

## 7. Acceptance Criteria

- [ ] Logs searchable by request ID.
- [ ] Operations metrics queryable per application and environment.
- [ ] Publish and fan-out latency measurable separately.
- [ ] Repeatable load test suite and documented results.
- [ ] Subscription recovery after DO hibernation verified.
- [ ] Slow consumers cannot grow memory without bound.
- [ ] No sensitive payloads in operational telemetry.
- [ ] Reconnect behavior tested under network interruptions.
- [ ] Credential revocation leaves auditable record.
- [ ] Alerts and incident runbook are documented.

## 8. Definition of Done

Operational metrics, baseline benchmark report, guardrails, and incident-response documentation are available before relying on the service for critical internal workflows.
