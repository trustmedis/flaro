# Publish events over HTTP

Backends publish realtime events with `POST /v1/apps/:appId/events` and a server API key; the service fans the event out to every socket subscribed to the channel and returns an `eventId`.

## Sub-features

- `pub-ok` — valid key plus valid body returns 200 `{eventId, accepted: true}`.
- `pub-no-subs` — publish with zero subscribers still returns accepted.
- `pub-auth` — missing, invalid, or revoked key returns 401/403 and no fan-out.
- `pub-validate` — malformed body (missing fields, bad channel name, oversized payload) returns a 4xx structured error.
- `pub-shape` — the `event` frame on subscribers carries `type:"event"`, `eventId`, `channel`, `event`, `data`.

## How to get to it (user POV)

- Backend service calls the publish endpoint server-side with its API key (PRD-03 `RealtimeServer.publish()` wraps this call).
- No browser path exists — clients never publish application events (PRD-01 non-goal).

## Driving it with ws-drive.mjs and curl

Preconditions: baseline from `../SKILL.md`.

- **pub-ok / pub-shape.** Plan on one socket: `subscribe public:orders` ok → `publish` to `$RTH_BASE_URL/v1/apps/$RTH_APP_ID/events` with `authorization: Bearer $RTH_API_KEY` and body `{"channel":"public:orders","event":"order.paid","data":{"orderId":"o-1"}}`, `expectStatus: 200` → `expectEvent public:orders/order.paid`. Observable: HTTP 200 body has `eventId` (`evt_` prefix per PRD example) and `accepted:true`; the `<<` event frame echoes channel/event/data with a matching `eventId`; `RESULT: ok`.
- **pub-no-subs.** Same publish to `public:empty-room` where nothing is subscribed → still 200 `accepted:true`. The point is the response, not delivery.
- **pub-auth.** Pure curl, no socket: `curl -i -X POST "$RTH_BASE_URL/v1/apps/$RTH_APP_ID/events" -H 'content-type: application/json' -d '{"channel":"public:x","event":"e","data":{}}'` with no `authorization` header → 401/403. Repeat with `-H "authorization: Bearer wrong"` → same. After revoking the key via admin, retry with the real key → rejected within the PRD-02 cache window (~30s).
- **pub-validate.** `publish` steps (or curl) with bodies `{}`, `{"channel":"bad name!","event":"e","data":{}}`, and a `data` payload over 64 KiB → each returns a 4xx structured error. Use `expectStatus` arrays (e.g. `[400, 413, 422]`) until the implementation pins exact codes — then tighten the recipe.

## Gotchas

- `accepted:true` means the DO accepted the publish, NOT that clients received it (PRD-01 §4) — delivery proof requires the `event` frame on a subscriber.
- Concurrent publishes have no guaranteed submission order (PRD-01 FR-03) — never assert ordering between two publish calls.
- A revoked key can stay valid for up to ~30s while caches refresh (PRD-02 FR-05) — retry inside that window before calling it a bug.
- An accepted publish with no subscribers is success, not an error.
