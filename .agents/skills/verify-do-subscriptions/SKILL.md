---
name: verify-do-subscriptions
description: Model-check the Realtime Hub application Durable Object's subscription bookkeeping with TLA+/TLC — proves subscribed clients keep receiving events across hibernation, unsubscribe stops delivery, and fan-out never reaches unsubscribed or disconnected sockets. Use when changing the DO's subscribe/unsubscribe/publish/hibernate logic or the WebSocket attachment metadata it rebuilds from.
---

# Verify DO subscription invariants (TLA+/TLC)

## The promise

Every event published to channel C is delivered to exactly the sockets currently subscribed to C — including after the Durable Object hibernates and wakes — and to nothing else.

**Harm if broken:** a client silently stops receiving realtime updates after an idle period (hibernation loses subscriptions), or keeps receiving events for channels it left — the failures PRD-01 FR-05 and its acceptance criteria exist to prevent, and the ones integration tests reach least reliably because they need real hibernation timing.

## The model

`ApplicationDO.tla` (config: `ApplicationDO.cfg`) in this directory models the DO's three stores:

- `subs` — the logical subscription set `<<conn, channel>>` (spec truth)
- `persisted` — per-socket attachment claims, the only state surviving hibernation
- `live` — the in-memory fan-out index; emptied on hibernate, rebuilt from `persisted` on wake

Actions map to code: `Connect`/`Disconnect` (WS accept/close), `Subscribe`/`Unsubscribe` (protocol handlers), `Hibernate`/`Wake` (DO hibernation API), `Publish` (fan-out RPC).

## Run it

```bash
./run.sh    # needs a JDK; downloads tla2tools.jar to ~/.cache/tla2tools on first run
```

Pass = `Model checking completed. No error has been found.` Fail = an invariant violation plus a shortest counterexample trace. For TLA+ results, read every violation with the pstack `/statechart` skill — it renders the counterexample as a plain-words path through the states.

## When a change touches this

Re-run `./run.sh` whenever the DO's subscription bookkeeping changes: the subscribe/unsubscribe handlers, the socket attachment serialize/deserialize code, the fan-out path, or hibernation/wake handling. Also re-run when the wire protocol's subscription semantics change.

If the code's real steps no longer match the model — a subscribe split into multiple awaited writes, a new channel type, attachment fields that change rebuild logic — update the model FIRST, from the code and not from the result, then rerun.

## Telling a real bug from a modeling error

- **Real bug:** every step in the counterexample is something the code can actually do, in an order it can produce. Replay it against the code; the harm is "client X stops or starts receiving events it shouldn't."
- **Modeling error:** a traced step can't happen in the code, or the model is stricter or looser than the code. Fix the model, say what was wrong, rerun.
- Never weaken an invariant or a bound to make it pass. If current code breaks the property, report the counterexample in the code's own terms — that IS the finding.

## Bounds and assumptions

- 3 connections x 2 channels (`ApplicationDO.cfg` constants). The properties are cardinality-insensitive; widen the constants if a change makes small bounds suspect — the state space grows fast.
- `Subscribe`/`Unsubscribe`/`Publish` are atomic steps. If the implementation splits a subscribe into multiple awaits (attachment write, then index update, with a yield between), split the model the same way — that interleaving is where races live.
- `Publish` requires `awake`: a publish to a hibernated DO wakes it and rebuilds before fan-out. If the implementation can fan out without rebuilding, the model is wrong — fix the model.
- Token auth, rate limits, payload validation, and cross-DO routing are out of scope — those are covered by live drives in `verify-realtime-hub`.

## Coverage record

- Spec source: `docs/prd/PRD-01-realtime-core.md` FR-02/FR-04/FR-05 and acceptance criteria; `docs/prd/PRD-02-auth-application-management.md` FR-06 isolation.
- Code coverage: PENDING — no implementation exists yet. When the DO lands, record the source files and functions each action maps to (expected: the application Durable Object class, its `webSocketMessage`/subscribe handlers, attachment serialize/deserialize, and the publish RPC) and the sync commit here.
- Sync anchor: `docs/prd/` as of 2026-11-18. This checkout has no VCS — record commits here once the repo is under version control.
- Last confirmed describing the code: never. The model was proven against the PRD spec at generation time — it passes on the correct model and fails on broken variants (subscribe that skips the attachment write; wake that rebuilds an empty index) — but has not yet been mapped to real code.

## Maintenance

After code lands or changes, run `/maintain-formal-verification-skill` to bring the model back in line with what the code actually does.
