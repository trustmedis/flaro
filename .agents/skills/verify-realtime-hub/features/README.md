# Realtime Hub verification map

This directory is the maintained source for verifying the user-facing behavior of Realtime Hub. Read the index before driving the service, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch per `../SKILL.md`: the Worker on `http://127.0.0.1:8787` (SPEC: `wrangler dev`) with a disposable `--persist-to` state dir.
- Provision one application and export `RTH_APP_ID`, `RTH_API_KEY` (server key, `events:publish` scope), `RTH_TOKEN_SECRET` (SPEC until the admin surface exists).
- Mint subscriber tokens with `../scripts/mint-token.mjs`; drive sockets with `../scripts/ws-drive.mjs --plan`.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every plan and command as literal; keep channel names, event names, and requestIds unchanged.
- Prefer protocol-level handles (channel names, event names, requestIds, HTTP routes) — there is no UI.
- Run socket actions through `node ../scripts/ws-drive.mjs --plan <file>` and publish/admin actions through `curl`.
- Restore seeded state after a mutation. Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final response.
- Publish proof includes the HTTP response and the `event` frame(s) on the right socket(s).
- Negative proof (`expectNoEvent`, `expect: "fail"`, `expectConnectError`) includes the window length and the frames that did arrive.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with <harness>` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Connect, subscribe, and receive events](./connect-and-subscribe.md) covers the WebSocket lifecycle, multi-channel subscriptions, unsubscribe, and fan-out delivery.
- [Publish events over HTTP](./publish-api.md) covers `POST /v1/apps/:appId/events`, publisher auth, response shape, and validation errors.
- [Private channel authorization](./private-channel-auth.md) covers subscriber tokens, exact channel claims, and forged/expired token rejection.
- [Application isolation](./app-isolation.md) covers cross-application publish and subscribe denial.
- [Health check](./health.md) covers `GET /health` for operators.
