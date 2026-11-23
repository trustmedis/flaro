# flaro — Realtime Hub

A Cloudflare-native internal publish/subscribe service. Clients subscribe over
WebSocket; trusted backends publish events over HTTP. One Durable Object per
application handles fan-out with WebSocket hibernation; D1 is the control
plane for apps, credentials, and token secrets.

## Layout

| Path | What |
| --- | --- |
| `apps/worker` | Hono Worker — routes, `ApplicationDO`, D1/Drizzle schema, Pusher-compatible endpoints |
| `apps/admin` | React + Vite admin SPA (Clerk auth), served by the worker at `/admin/` |
| `packages/protocol` | `@internal/realtime-protocol` — wire protocol messages, schemas, constants |
| `packages/server` | `@internal/realtime-server` — server-side publish SDK |
| `packages/client` | `@internal/realtime-client` — browser/client subscribe SDK |
| `docs/prd` | Product/design docs (PRD-01 … PRD-04) |

## Quick start

Requires Node >= 22 and pnpm.

```bash
pnpm install

# worker secrets for local dev
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# → set ADMIN_SECRET to any random string

# apply D1 migrations to local state
pnpm --filter @internal/worker db:migrate:local

pnpm dev    # wrangler dev on http://127.0.0.1:8787
```

Sanity check:

```bash
curl -sf http://127.0.0.1:8787/health        # {"ok":true,...}

# create an application (response includes tokenSecret — shown once)
curl -X POST http://127.0.0.1:8787/admin/apps \
  -H "authorization: Bearer $ADMIN_SECRET" \
  -H 'content-type: application/json' \
  -d '{"name":"my-app","environment":"dev"}'

# mint a publish API key for it (apiKey shown once)
curl -X POST http://127.0.0.1:8787/admin/apps/<app-id>/credentials \
  -H "authorization: Bearer $ADMIN_SECRET" \
  -H 'content-type: application/json' \
  -d '{"scopes":["events:publish"]}'
```

To run the admin UI through the worker, build it once:
`pnpm --filter admin build` → http://127.0.0.1:8787/admin/

## Endpoints

| Route | Purpose | Auth |
| --- | --- | --- |
| `GET /health` | liveness + protocol version | none |
| `GET /v1/connect?token=…` | WebSocket connect + subscribe (native protocol) | HS256 subscriber token |
| `POST /v1/apps/:appId/events` | publish one event (native protocol) | `rth_key_…` API key, `events:publish` scope |
| `GET /app/:key` | Pusher-compatible WebSocket (`key` = app id) | pusher-js signing |
| `POST /apps/:id/events`, `POST /apps/:id/batch_events` | Pusher-compatible publish | Pusher request signature |
| `GET /apps/:id/channels[/…]` | Pusher-compatible channel info | Pusher request signature |
| `/admin/*` | app + credential management | `ADMIN_SECRET` bearer or Clerk JWT |

## Environment variables

Each app has an `*.example` file to copy: `apps/worker/.dev.vars.example` →
`apps/worker/.dev.vars` (loaded by `wrangler dev`), `apps/admin/.env.example` →
`apps/admin/.env` (loaded by Vite). For `pnpm dev`:

- `apps/worker/.dev.vars` → `ADMIN_SECRET` (required for `/admin/*` without
  Clerk). `CLERK_ISSUER` optional — defaults to the dev instance in
  `wrangler.toml`; set `http://127.0.0.1:8899` to use `node clerk-mock.mjs`.
- `apps/admin/.env` → `VITE_CLERK_PUBLISHABLE_KEY` (required — the SPA throws
  at startup without it).
- Deployed: `pnpm deploy:worker`, secrets via `wrangler secret put`.

## Scripts

```bash
pnpm dev           # worker dev server (wrangler dev, :8787)
pnpm build         # build all packages + admin, then remote D1 migrate
pnpm typecheck     # tsc across workspaces
pnpm test          # vitest across workspaces
pnpm deploy:worker # wrangler deploy → flaro.trustmedis.net
```

Smoke tests: `node apps/worker/pusher-smoke.mjs` (needs `APP` + `SECRET` env)
and the `verify-realtime-hub` agent skill under `.agents/skills/` for end-to-end
WebSocket/publish proofs.

## Design docs

`docs/prd/` — PRD-01 realtime core, PRD-02 auth & app management, PRD-03 SDK &
DX, PRD-04 observability. Assumptions: internal/trusted apps only, ephemeral
best-effort events, no presence/replay/multi-tenant billing.
