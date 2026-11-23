# Application isolation

Every application gets its own Durable Object and credential set; a key or token from app A can never publish to, subscribe to, or confirm the existence of app B's channels.

## Sub-features

- `iso-pub` — app A's API key on app B's publish path returns 401/403/404 and no `accepted:true`.
- `iso-sub` — events published by app B never reach app A's sockets, even on identical channel names.
- `iso-exist` — cross-app errors must not reveal whether the other application exists (PRD-02 §6).

## How to get to it (user POV)

- Each trusted backend holds only its own app's credentials; misconfiguration or a leaked key must not cross boundaries (PRD-02 FR-06).

## Driving it with ws-drive.mjs and curl

Preconditions: baseline from `../SKILL.md` plus a SECOND provisioned application. Export `RTH_APP_ID_B`, `RTH_API_KEY_B`, `RTH_TOKEN_SECRET_B` for app B (SPEC until the admin surface exists).

- **iso-pub.** `curl -i -X POST "$RTH_BASE_URL/v1/apps/$RTH_APP_ID_B/events" -H "authorization: Bearer $RTH_API_KEY" -H 'content-type: application/json' -d '{"channel":"public:x","event":"e","data":{}}'` — app A's key on app B's path → 401/403/404, never `accepted:true`.
- **iso-sub.** Socket on app A subscribed to `public:shared`. Plan steps: `publish` via app B's endpoint (`$RTH_BASE_URL/v1/apps/$RTH_APP_ID_B/events`, `Bearer $RTH_API_KEY_B`) `{"channel":"public:shared","event":"b.only"}` → `expectNoEvent public:shared/b.only` (windowMs 800) → `publish` via app A `{"channel":"public:shared","event":"a.only"}` → `expectEvent`. Observable: B's event absent on A's socket; A's event present — the socket was alive and listening the whole time.
- **iso-exist.** Compare the cross-app publish error body/status against a nonexistent appId (`/v1/apps/no-such-app/events` with a valid key). Observable: indistinguishable responses — no oracle for app existence.

## Gotchas

- Channel names are per-app namespaces — identical names across apps are different channels; that IS the isolation, not a bug.
- Whether the implementation answers 403 or 404 for cross-app keys is a design choice; either satisfies "don't reveal existence" — record which it chose and keep the recipe tolerant (`expectStatus` arrays).
- DO routing is by verified app identity from auth (PRD-02 FR-06), not a client-supplied parameter — a test that lets the caller pick the app would test the wrong thing.
- App B's subscriber token legitimately connects to app B's DO; isolation means it can never reach app A's channels — `iso-sub` is the proof, not a rejected handshake.
