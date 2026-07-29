---
name: db-migration
description: Add or change a database table or column across both SQLite and Postgres. Use when creating a migration, altering the schema, adding an index, or when a change touches vision.md §9 tables — context_item, checkpoint, handoff, conflict, actor, project, session.
---

# Schema migration

The schema is specified in `vision.md` §9. Implement it as written — the column set was chosen
against the M4 and M5 requirements, and the expensive parts are expensive because they cannot be
added later.

## Before writing anything

**Is this column in §9?** If yes, implement it exactly, including the ones that look premature.
`access_scope` and the bi-temporal columns are cheap now and a migration nightmare once M4 has
multi-actor data in flight.

**Is this a new column not in §9?** That is a `vision.md` change. Ask the founder first — do not
extend the spec through implementation.

## The procedure

1. **Both engines, same PR.** SQLite (local) and Postgres + pgvector (hosted). A migration that lands
   on one engine only is not landed.
2. **Forward-only and versioned.** No down migrations. Self-hosted users upgrade on their own
   schedule (§15), so a runner meeting a store newer than the binary must refuse to operate rather
   than half-apply.
3. **Update the seed harness** (MNE-47) so fixtures cover the new shape — humans and agents,
   superseded chains, disputed items, load-bearing constraints.
4. **Round-trip test.** Write and read back every new column, on both engines. `embedding`,
   `valid_to`, and `supersedes_id` are the ones that break quietly.
5. **Parity test** (MNE-46) if the change touches retrieval. Same corpus and query must return the
   same top-k ordering on both engines within the documented tolerance.
6. **Telemetry.** A new write path needs its §17 event in the same PR — the coverage test (MNE-51)
   will fail otherwise, and that is the test doing its job.
7. `pnpm test` green on both engines before the PR.

## Things that will bite

**Vector columns.** pgvector on Postgres, `sqlite-vec` locally. Never mix embedding models or
dimensions in one index — the result is retrieval that is subtly wrong rather than broken, which can
go unnoticed for months and quietly poisons the §17 signal used to tune ranking. A model change
triggers a backfill, not a silent mix.

**Enums.** `actor_kind`, `item_kind`, `item_status` differ between engines. Keep the mapping in one
place; do not scatter string literals.

**Timestamps.** `TIMESTAMPTZ` everywhere. Store UTC. The bi-temporal queries are wrong in ways nobody
notices until an audit if local time creeps in.

**`supersedes_id` / `superseded_by_id`.** Self-referencing and bidirectional. Both sides get written,
or the M2 "Superseded recently" block (MNE-90) renders incomplete — and that block is the highest-value
section of the handoff artifact.

## Done when

Migrations run from empty on both engines, the round-trip test passes on both, every new write path
emits its event, and the *Done when* clause on the Linear ticket is satisfied.
