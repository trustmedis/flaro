---
name: verify-realtime-hub
description: Drive the Realtime Hub service (Cloudflare Worker + Durable Objects pub/sub) on localhost and prove realtime behavior end to end — WebSocket connect/subscribe, HTTP publish fan-out, subscriber auth, app isolation. Use when changing the worker routes, the application Durable Object, the wire protocol, auth, or the SDKs and the proof needs the real running service rather than unit tests.
---

# Verify Realtime Hub

The service is implemented in this repo: `apps/worker` (Hono Worker + `ApplicationDO` Durable Object + D1 control plane) and `packages/{protocol,server,client}` (the `@internal/realtime-*` SDKs). Core flows were proven live on 2026-11-18: connect, subscribe (public + claimed private), publish fan-out, unsubscribe, and auth rejection. Remaining gaps are listed under Known gaps.

There is no UI — the "user" is a backend publisher and a browser/SDK client speaking the PRD-01 wire protocol.

## Launch

Prereqs: Node >= 22 (helpers use the native `WebSocket` global), pnpm.

From the repo root:

```bash
pnpm install
pnpm --filter @internal/worker db:migrate:local   # applies D1 migrations to local state
RUN_ID="$(date +%s)"
pnpm dev -- --port 8787 --persist-to ".wrangler/verify-$RUN_ID"   # wrangler dev; args pass through
```

`--persist-to` gives this run its own D1 + Durable Object state so concurrent runs never share data. `ADMIN_SECRET` comes from `apps/worker/.dev.vars` (already present for local dev). Record the PID of the process you started.

Ready means usable, not just listening: `wrangler` prints `Ready on http://localhost:8787` **and** `curl -sf http://127.0.0.1:8787/health` returns `{"ok":true,...}`. A health check can pass while DO bindings are still initializing — the first real drive is the true readiness probe.

Provision before driving — the admin API is real (PRD-02 FR-01, secured by `ADMIN_SECRET`):

```bash
export RTH_BASE_URL=http://127.0.0.1:8787
export RTH_ADMIN="authorization: Bearer $ADMIN_SECRET"   # from apps/worker/.dev.vars

# create an application — response includes tokenSecret, shown once
curl -s -X POST "$RTH_BASE_URL/admin/apps" -H "$RTH_ADMIN" -H 'content-type: application/json' \
  -d '{"name":"verify-app","environment":"dev"}'
# → {"id":"app_...","tokenSecret":"..."}

# mint a server API key (events:publish) — apiKey shown once
curl -s -X POST "$RTH_BASE_URL/admin/apps/$RTH_APP_ID/credentials" -H "$RTH_ADMIN" \
  -H 'content-type: application/json' -d '{"scopes":["events:publish"]}'
# → {"keyId":"key_...","apiKey":"rth_key_..._..."}

export RTH_APP_ID=<app-id>
export RTH_API_KEY=<apiKey>
export RTH_TOKEN_SECRET=<tokenSecret>
```

For isolation recipes, provision a second app the same way (`RTH_APP_ID_B`, `RTH_API_KEY_B`, `RTH_TOKEN_SECRET_B`).

Never drive an instance you did not start. Two instances are isolated by `--port` plus a distinct `--persist-to` dir.

## Doctor

Run before the first drive and after anything surprising. All must pass:

```bash
curl -sf "$RTH_BASE_URL/health"                                   # 200 + {"ok":true}
ss -ltnp | grep 8787                                              # port owned by our workerd, not a stranger's
curl -s -o /dev/null -w '%{http_code}' -X POST \
  "$RTH_BASE_URL/v1/apps/$RTH_APP_ID/events" \
  -H 'content-type: application/json' -d '{}'                    # expect 401 — proves auth is live, not stubbed
```

If doctor fails because the app changed shape, fix this skill (edit scope: this directory only) and retry once.

## Drive

Two helpers ship with this skill; both are executable and documented under Helpers. Every recipe in `features/` is a JSON plan for `scripts/ws-drive.mjs` — write it to a temp file (or pass `--plan-json`) and run it. The plan carries the WebSocket URL, subscribe/unsubscribe steps, HTTP publish calls, and event expectations in order.

Smoke test — proves connect, subscribe, publish, fan-out in one shot:

```bash
TOKEN="$(node scripts/mint-token.mjs --secret "$RTH_TOKEN_SECRET" --app "$RTH_APP_ID" \
  --sub smoke-user --channels public:smoke --iss "$RTH_APP_ID-backend" --aud realtime-hub --ttl 300)"

cat > /tmp/rth-plan.json <<EOF
{
  "url": "ws://127.0.0.1:8787/v1/connect?token=$TOKEN",
  "steps": [
    {"op": "subscribe", "channel": "public:smoke", "expect": "ok"},
    {"op": "publish", "url": "$RTH_BASE_URL/v1/apps/$RTH_APP_ID/events",
     "headers": {"authorization": "Bearer $RTH_API_KEY"},
     "body": {"channel": "public:smoke", "event": "smoke.ping", "data": {"n": 1}},
     "expectStatus": 200},
    {"op": "expectEvent", "channel": "public:smoke", "event": "smoke.ping", "timeoutMs": 3000}
  ]
}
EOF
node scripts/ws-drive.mjs --plan /tmp/rth-plan.json | tee .verify-evidence/realtime-hub/last-run/ws.log
```

## Evidence

Write each run's artifacts to `.verify-evidence/realtime-hub/<UTC-timestamp>/` at the repo root (create it; it survives cleanup). Capture:

- The full `ws-drive.mjs` stdout — every `>>`/`<<` frame plus the `RESULT` line.
- `curl -i` transcripts for publish/admin calls, including status and body.
- Exit codes of every command.

Proof standards:

- Exercise the real path: an actual WebSocket upgrade and the wire-protocol messages, or the real HTTP publish route — never DO internals or test-only endpoints.
- Capture the action and the resulting state: a publish step alone proves nothing; the matching `event` frame on the right socket (and its absence on the wrong one) is the proof.
- Verify side effects: events received by exactly the subscribed connections; D1 rows for admin changes (`pnpm --filter @internal/worker exec wrangler d1 execute realtime-hub --local --command 'select ...'`).
- **Redact secrets.** API keys, bearer tokens, `tokenSecret`, and subscriber tokens never land in evidence — the PRDs forbid them in logs. Replace values with `<redacted>` in saved transcripts; plans containing live tokens go to `mktemp` files, not the repo.
- A skipped entry point is reported as skipped with the unmet precondition — never as verified through a different path.

## Cleanup

- Kill only the PID this run started (`kill "$WRANGLER_PID"` — record it at launch). Never `pkill`/`killall` by name.
- Remove the disposable persist dir `.wrangler/verify-$RUN_ID` if one was used.
- Evidence under `.verify-evidence/` is never deleted by cleanup.
- Failed iterations get the same cleanup — no stranded workerd processes or ports.

## Helpers

- `scripts/mint-token.mjs` — mints a subscriber token per PRD-02 FR-03: HS256 compact JWS over claims `{appId, sub, channels, iss, aud, iat, exp}` (TTL <= 300s). The worker's verifier (`apps/worker/src/auth.ts`) accepts exactly this format — keep them in sync. Usage: `node scripts/mint-token.mjs --help`.
- `scripts/ws-drive.mjs` — drives one WebSocket connection through the wire protocol. `--plan <file>` or `--plan-json '<json>'`; plan schema in the script header comment and exercised by every feature file. Prints each sent/received frame and a final `RESULT: ok|fail`; exit 0 only when every step's expectation held. Also proven against a protocol mock and the real service.

## Feature map

`features/README.md` indexes the user-facing features and the baseline preconditions every recipe assumes. A proof that drives one entry point is incomplete when the map lists others.

## Maintenance

After the app changes, run `/maintain-verification-skill` to re-check the map and harness against the code.

## Known gaps

- Admin app-management feature files (create/disable app, credential lifecycle, token-secret rotation, audit) are not yet in the feature map — the endpoints exist (`/admin/*`); add feature files when first needed.
- Hibernation recovery (PRD-01 FR-05) has no live-drive recipe; workerd's hibernation behavior under `wrangler dev` needs validation before writing one (the TLA+ model in `verify-do-subscriptions` covers the logic meanwhile).
- Reconnect/resubscribe is covered at SDK level (`@internal/realtime-client`); a dedicated `verify-realtime-sdk` skill is the right home once SDK behavior needs deeper proofs (backoff, token refresh, resubscribe ordering).
- Presence channels, replay, and sharding are PRD non-goals/Later — no recipes.
- Benchmark/load recipes (PRD-04 FR-03) are not covered here; they belong to a load-test harness, not this skill.
