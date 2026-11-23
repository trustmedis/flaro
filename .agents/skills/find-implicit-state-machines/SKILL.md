---
name: find-implicit-state-machines
description: Inventory the implicit state machines in an app — entity lifecycle smeared across booleans, nullable fields, timestamps, and status strings. Reports real states, transitions, impossible-but-allowed combinations (file:line), and risk. Read-only; use before refactoring to explicit state modeling or when auditing lifecycle bugs.
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Find Implicit State Machines

Analyze the codebase for logic that implements state machines without naming
them — state encoded in booleans, nullable columns, timestamp presence, status
strings, and enum-like unions rather than an explicit state type.

**Read-only. Do not modify any file.** Produce a report; a later phase decides
what to fix.

## What counts

An implicit state machine needs an entity with **≥2 observable states** and
**≥1 transition** between them, where "state" is inferred from field values
rather than declared. A lone static flag is not a state machine.

Typical encodings — hunt all of them:

- **Status/kind/phase strings** — `status: 'active' | 'disabled'`, `type`,
  `mode`, `role`, `step`, string columns compared to literals.
- **Booleans** — `is_active`, `disabled`, `verified`, `revoked`, `archived`,
  `has_*, can_*`. Pairs of booleans are the richest source: 2 flags = 4
  combos, usually only 2–3 are meaningful.
- **Nullable presence** — `deletedAt`, `expiresAt`, `revokedAt`,
  `lastRotatedAt`, `socket_id`: `!= null` *is* the state. Same for optional
  FKs and "empty string/array means unset".
- **Enum-like unions** — TS unions, DB enums, CHECK-less varchar columns.
- **Protocol/session state** — connection phase inferred from what has
  arrived (auth sent? subscribed? socket_id assigned?), DO storage keys,
  in-memory maps whose presence = state.

## Procedure

### 1. Map the entities

Find every place persistent or session state is defined: ORM schemas
(Drizzle/Prisma), migrations, protobufs, TS interfaces/types, DO/KV/Redis
storage layouts, React state that gates flows. `fd`/glob for `schema.*`,
`migrations/`, `*.types.ts`, `models/`, `entities/`.

### 2. Collect candidate state fields per entity

```
rg -n "status|state|phase|step|mode|kind|role" --type ts
rg -n "\b(is|has|can|disabled|active|verified|revoked|archived|deleted|enabled)[A-Z_]\w*"
rg -n "\w+(At|_at)\b"          # timestamps — nullable ones are states
rg -n "===?\s*['\"][a-z_]+['\"]|!==?\s*['\"][a-z_]+['\"]"   # literals = state checks
rg -n "\?\.|!= null|!== null|== null" | <fields found above>
```

Skip vendored/test fixture dirs; note fields that are **written together**
(they form one composite state, not independent flags).

### 3. Enumerate transitions (writes)

Every site that creates or mutates the field is a transition edge:

```
rg -n "\.update\(|\.set\(|UPDATE .* SET|insert|\.put\(|storage\.|\.save\(" <file-set>
```

Record for each write: which fields change, from-what precondition (if any
guard exists), and who can trigger it (route → auth → handler).

### 4. Enumerate state assumptions (reads)

Where code branches or filters on the fields — `where(eq(col, 'x'))`,
`if (row.status ===`, `switch`, serialization that hides "inactive" rows.
Reads reveal the *intended* states; the gap between intended and writable is
where the findings live.

### 5. Reconstruct states and transitions

- **States**: the distinct field-combinations the reads treat as meaningful
  (e.g. `status='active'`, `status='disabled'`; `deletedAt IS NULL` vs not).
- **Transitions**: the writes, labeled `state → state` via which trigger
  (endpoint/job/timer), and whether guarded.
- Flag missing transitions too (states with no way out/in).

### 6. Find impossible-but-allowed combinations — the core deliverable

For each machine, produce **at least one** combination the domain says is
impossible but nothing prevents. Qualifying examples:

- Flag/field combos with no CHECK, enum, NOT NULL, or code guard
  (`status='disabled'` **and** `expiresAt` still in the future → is a
  disabled app's key still valid?).
- A transition reachable without its precondition — a public route or an
  internal call path that skips the guard another path enforces.
- Two writes that must be atomic but aren't (state A persisted, state B in a
  second write that can fail/be reordered).
- Nullable-field combos the reads pattern-match wrongly (`expiresAt` null =
  "never expires" vs "not yet set" conflated).
- States reachable by reordering (unsubscribe arriving after channel deleted,
  token minted for disabled app because validity checked at connect not mint).

**Rules for a valid finding**: reachable through a real code path (cite the
exact `file:line` of the write or the missing check), state which invariant
breaks, and what a reader would misinterpret. No hypothetical DB edits, no
"could be null" without a path that produces it.

### 7. Rate risk

- **high** — reachable via external/untrusted input, crosses a security or
  billing boundary, silently corrupts data, or has no recovery path.
- **medium** — reachable via internal callers or races; wrong behavior but
  bounded blast radius or manual recovery exists.
- **low** — cosmetic, dead state, or requires already-privileged access to
  reach; documentation-grade.

## Output format

Sort machines by risk (high first). For each:

```markdown
### <n>. <Machine name — entity + what lifecycle>
1. **Feature & files**: <feature> — <paths>
2. **State encoding**: <fields/flags/strings> — <file:line where defined>
3. **States & transitions**:
   - States: <list>
   - Transitions: <A → B via <trigger> (file:line, guarded by X | unguarded)>
4. **Impossible but allowed**: <combination> — <why it should be impossible>,
   allowed because <exact file:line of write / missing check>
5. **Risk**: <high|medium|low> — <one-line justification>
```

End with a summary table: `| # | Machine | Files | Risk |`.

## Guardrails

- Every claim cites `file:line`. No line, no claim.
- Distinguish *allowed by schema* from *reachable in code* — only the latter
  counts for finding #4, but note schema-level gaps as secondary observations.
- Machines in test files/fixtures don't count, but test helpers that mirror
  production encodings are worth a footnote.
- If a field has zero writes and zero branch reads, it's dead state — report
  it as low risk, don't invent a machine around it.
- Report each machine on its own evidence; don't merge two entities into one
  machine because they share a field name.
