---
name: db-migration
description: Add or change a database table, column, or index on hosted Postgres. Use when creating a migration, altering the schema, adding an index, or when a change touches vision.md §9 tables — context_item, checkpoint, handoff, conflict, actor, project, team, session.
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

1. **One engine: Postgres + pgvector, hosted** (§11.1). There is no SQLite and no local store, so
   there is no second adapter and no parity step.
2. **Forward-only and versioned.** No down migrations. Because we operate the only database, a
   migration must also be **safe to apply while old clients are still running** — old CLI versions
   stay in the wild for weeks. Add columns nullable, backfill separately, drop in a later release.
3. **Regenerate the schema snapshot.** `pnpm db:snapshot` rewrites `db/structure.sql`, and it
   belongs in the *same commit* as the migration. CI runs `pnpm db:snapshot --check` against a
   fresh container and fails when the two disagree, so a forgotten regeneration is a red build
   rather than silent drift. Never hand-edit it — the diff on that file is how a reviewer sees
   what your migration actually did to the schema.
4. **Update the seed harness** (MNE-47) so fixtures cover the new shape — humans and agents,
   superseded chains, disputed items, load-bearing constraints.
5. **Round-trip test.** Write and read back every new column. `embedding`, `valid_to`, and
   `supersedes_id` are the ones that break quietly.
6. **Scope test if the change touches reads.** Every query is tenant- and scope-filtered (MNE-169).
   A new index or join that bypasses the filter is a cross-workspace data leak, not a perf detail.
7. **Telemetry.** A new write path needs its §17 event in the same PR — the coverage test (MNE-51)
   will fail otherwise, and that is the test doing its job.
8. `pnpm test` green before the PR.
9. **Merging applies it.** `.github/workflows/migrate-production.yml` runs `pnpm db:migrate`
   against production, and `deploy-web` calls it as a job `ship` depends on, so the order is
   migrate → gate → deploy. You do not run anything by hand, but the migration must be safe under
   the code *currently* deployed — the gate permits only migrate-then-deploy. Backfill in one
   migration, constrain in the next.

## Things that will bite

**Vector columns.** pgvector, `ivfflat`. Never mix embedding models or dimensions in one index — the
result is retrieval that is subtly wrong rather than broken, which can go unnoticed for months and
quietly poisons the §17 signal used to tune ranking. A model change triggers a backfill, not a silent
mix. Record the model identity alongside every stored vector.

**Enums.** `actor_kind`, `item_kind`, `item_status`, `access_scope`, `team_function`. Postgres enums
cannot drop a value and cannot add one inside a transaction on older versions. Keep the TypeScript
mapping in one place; do not scatter string literals.

**Timestamps.** `TIMESTAMPTZ` everywhere. Store UTC. The bi-temporal queries are wrong in ways nobody
notices until an audit if local time creeps in.

**`supersedes_id` / `superseded_by_id`.** Self-referencing and bidirectional. Both sides get written,
or the M2 "Superseded recently" block (MNE-90) renders incomplete — and that block is the highest-value
section of the handoff artifact.

## Done when

Migrations run clean from empty, the round-trip test passes, reads stay scope-filtered, every new
write path emits its event, and the *Done when* clause on the Linear ticket is satisfied.
