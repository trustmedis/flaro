# Health check

`GET /health` reports whether the API Worker itself is available — it does not probe Durable Objects (PRD-04 FR-02). Operators and monitors use it; a separate synthetic publish-subscribe probe covers realtime health.

## Sub-features

- `health-ok` — returns 200 with an ok/status body when the Worker is up.
- `health-down` — connection refused or non-200 when the Worker is not running.

## How to get to it (user POV)

- Ops/monitoring hits `GET /health` on the service origin; nothing else calls it in the request path.

## Driving it with curl

Preconditions: baseline from `../SKILL.md`.

- **health-ok.** `curl -si "$RTH_BASE_URL/health"` → HTTP 200 and a JSON body indicating ok (SPEC shape — confirm field names on first run). Observable: status line plus body captured.
- **health-down.** Only against an instance this run started and already tore down: same command → connection refused or non-200. Never run this against a shared dev server.

## Gotchas

- A 200 from `/health` does NOT prove realtime works — DOs, auth, and fan-out are unchecked (PRD-04 FR-02). Never cite `health-ok` as publish or subscribe proof.
- Do not drive `health-down` against an instance you did not start.
