# Connect, subscribe, and receive events

A client opens one authenticated WebSocket to `/v1/connect`, receives `connection.ready`, subscribes to channels with `subscribe` frames, and receives `event` frames for published messages on exactly those channels — several channels multiplexed over the single socket.

## Sub-features

- `ws-connect` — upgrade plus token auth yields `connection.ready` with a server-issued connection id.
- `sub-public` — `subscribe` on `public:<name>` returns `subscription.succeeded`.
- `sub-multi` — one socket holds subscriptions to multiple channels at once.
- `fanout` — a publish to a subscribed channel arrives as an `event` frame; publishes to unsubscribed channels do not.
- `unsub` — `unsubscribe` stops further delivery on that channel while the socket stays usable.

## How to get to it (user POV)

- App frontend: the SDK's `connect()` + `channel(...).subscribe()` — under the hood this is the WS upgrade and subscribe frames below (PRD-03).
- Direct protocol client: any WebSocket client to `GET /v1/connect?token=<subscriber-token>` (SPEC: token passing mechanism — confirm query param vs header vs first frame).

## Driving it with ws-drive.mjs and curl

Preconditions: baseline from `../SKILL.md` — service up, doctor green, `RTH_*` env exported. Mint a token covering the channels used:

```bash
cd .agents/skills/verify-realtime-hub
TOKEN="$(node scripts/mint-token.mjs --secret "$RTH_TOKEN_SECRET" --app "$RTH_APP_ID" \
  --sub user-1 --channels public:alpha,public:beta --iss "$RTH_APP_ID-backend" --aud realtime-hub --ttl 300)"
```

- **Connect + subscribe public.** Plan steps: `{"op":"subscribe","channel":"public:alpha","expect":"ok"}`. Run `node scripts/ws-drive.mjs --plan plan.json`. Observable: `<< {"type":"connection.ready",...}`, then `<< {"type":"subscription.succeeded",...}`, `RESULT: ok`.
- **Multi-channel fan-out.** Same socket subscribes `public:alpha` and `public:beta`; two `publish` steps send `fanout.one` to alpha and `fanout.two` to beta; `expectEvent` each. Observable: each `event` frame echoes its own `channel`; `RESULT: ok`.
- **Unsubscribed channel filtered.** With the socket subscribed only to alpha/beta, publish `fanout.secret` to `public:never-subscribed` and `expectNoEvent` it (windowMs 800), then publish `fanout.alive` to alpha and `expectEvent` it. Observable: no frame for the unsubscribed channel; the alpha frame proves the socket was live.
- **Unsubscribe stops delivery.** Steps: subscribe alpha ok → publish `unsub.e1` to alpha → expectEvent → `unsubscribe` alpha → sleep 100 → publish `unsub.e2` to alpha → `expectNoEvent` alpha/unsub.e2 (windowMs 800) → publish `unsub.e3` to beta → expectEvent. Observable: no second alpha delivery; beta still delivers; `RESULT: ok`.

## Gotchas

- `expectNoEvent` only watches deliveries during its window — always follow it with a positive `expectEvent` on a live channel or a dead socket passes silently.
- Subscribe acks correlate by `requestId`; ws-drive falls back to channel matching if the server omits it. If a subscribe times out, read the `<<` frames before assuming a bug.
- Repeated `subscribe` for the same channel must not double-deliver (PRD-01 AC) — the plan can send the same subscribe twice and expect exactly one event per publish.
- Public channels need an authenticated connection but no per-channel claim (PRD-02 FR-04); don't mint claims for them.
