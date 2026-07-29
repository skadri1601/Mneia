---
paths:
  - "packages/core/src/schema/**"
  - "packages/core/src/store/**"
  - "**/migrations/**"
  - "**/*.sql"
---

# Data model rules

The schema is specified in `vision.md` §9. **Implement it as written.** It is not a sketch — the
column set was chosen against the M4 and M5 requirements, and the expensive parts are expensive
precisely because they cannot be added later.

## Three things that are not negotiable

**1. `actor_kind` distinguishes human from agent, as a first-class enum.**
Not a nullable `user_id`, not a boolean flag. Rehydration reads it to decide what to trust; conflict
resolution reads it to decide who arbitrates. Every §10.4 rule depends on it. Collapsing it breaks
the product, not just the schema.

**2. Bi-temporal columns ship in the first migration.**
`valid_from`, `valid_to`, `supersedes_id`, `superseded_by_id`. They answer *"what did we believe on
March 3rd"* — which is the M4 timeline view and the M5 audit export. Retrofitting bi-temporality onto
a store with real history is close to impossible. Same reasoning applies to `access_scope`: cheap now,
a migration nightmare once M4 has multi-actor data in flight.

**3. `load_bearing` decides whether a contradiction blocks or merely logs.**
§9 calls getting this flag right *"most of the product quality."* Treat it as load-bearing itself.

## Engine parity

Every change lands on **both** SQLite (local) and Postgres + pgvector (hosted), in the same PR.

Divergence is corrosive in a specific way: a user who develops locally and syncs to hosted would get
different rehydration slices from identical data, and would reasonably conclude the product is
unreliable. The parity test (MNE-46) exists to catch exactly that.

Migrations are versioned and forward-only. A runner that meets a store newer than the binary must
refuse to operate rather than half-apply — self-hosted users upgrade on their own schedule (§15).

## Writes

- Every `context_item` write is attributable to a checkpoint via `checkpoint_item`, with the correct
  `action`: `created` / `updated` / `superseded` / `rejected`. Attribution is what makes this a
  record rather than a cache (§8.1 rule 1).
- Checkpoint writes are atomic. An interrupted checkpoint leaves no partial state.
- Every write emits its §17 event — see `telemetry.md`.

## The `conflict` table

Ships in M0 even though resolution is M4. §10.4: **"This table is the moat asset."** Detection starts
in M1, and a detected conflict with nowhere to be recorded is a training example we never get back.
