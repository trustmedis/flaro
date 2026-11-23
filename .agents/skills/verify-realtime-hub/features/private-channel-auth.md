# Private channel authorization

`private:<name>` channels require a subscriber token whose signed claims list that exact channel; public channels need only an authenticated connection. Forged, expired, or wrongly-signed tokens never open a socket.

## Sub-features

- `priv-allow` — a token claiming `private:records` subscribes successfully and receives events.
- `priv-deny` — a token without the claim gets `subscription.failed` on that channel.
- `priv-exact` — claims match exactly; `private:records` does not authorize `private:records-2` and there are no wildcards in MVP.
- `tok-expired` — an expired token is rejected at connect.
- `tok-forged` — a bad signature, wrong secret, or tampered payload is rejected at connect.
- `key-not-token` — a server API key is not a subscriber token.

## How to get to it (user POV)

- The app backend mints a short-lived token (max 5-minute TTL, PRD-02 FR-03) per user and hands it to the frontend; the SDK passes it on connect (PRD-03 `getToken`).

## Driving it with ws-drive.mjs and curl

Preconditions: baseline from `../SKILL.md`. `RTH_TOKEN_SECRET` is the HMAC secret the worker verifies against (SPEC — confirm the token format and claim names the implementation chose; `scripts/mint-token.mjs` is the reference).

- **priv-allow.** Token with `--channels private:records,public:lobby`. Plan: `subscribe private:records` ok → `publish` to `private:records` → `expectEvent`. Observable: `subscription.succeeded` then the `event` frame; `RESULT: ok`.
- **priv-deny.** Same token, `subscribe private:other` with `"expect":"fail"`, then `subscribe public:lobby` ok to prove the socket survived. Observable: `subscription.failed` correlated to the request, then `subscription.succeeded` for the public channel.
- **priv-exact.** Token claims only `private:records`; `subscribe private:records-2` expect fail. Wildcards are not supported in MVP — `private:*` in claims must not authorize anything.
- **tok-expired.** Mint with `--ttl 1`, `sleep 2`, then run a plan `{"expectConnectError": true, "steps": []}`. Observable: connect/handshake rejected (connection.error, close, or HTTP error — whichever the implementation uses); `RESULT: ok`.
- **tok-forged.** Same plan shape but token minted with `--secret definitely-wrong`. Observable: connect rejected.
- **tok-tampered.** Mint valid, flip one character in the payload segment, run the expectConnectError plan. Observable: connect rejected.
- **key-not-token.** Plan `url` = `ws://127.0.0.1:8787/v1/connect?token=$RTH_API_KEY` with `expectConnectError` — a server API key must not work as a subscriber token (PRD-02 AC).

## Gotchas

- Token format is SPEC (HS256 compact JWS assumed). If connect rejects a correctly-minted token, check the worker's expected format and claim names before calling it a bug — update `mint-token.mjs` to match the implementation.
- Expiry is checked at connect; an already-open socket is NOT closed when its token expires (PRD-02 FR-03 note) — do not expect a mid-session kick.
- `subscription.failed` is per-channel; the socket remains usable — always follow a denied subscribe with an allowed one.
- Never put real tokens in committed files; plans live in `mktemp` files and evidence redacts them.
