# @mneia/core

The data model, store adapters, checkpoint, rehydration, handoff render, and telemetry. Apache 2.0.

Root `AGENTS.md` applies. `.claude/rules/architecture.md`, `data-model.md`, and `telemetry.md` carry
the detail — read them before changing anything here.

**Dependency direction is one-way.** `cli` and `mcp-server` depend on this package; it never imports
from either, and they never import from each other. A behaviour needed by both surfaces belongs here.
That is what makes MNE-104 possible — the CLI and the MCP server returning identical results for the
same input requires the logic to live in one place.

**Never add server concerns.** This package holds the schema, the prompts, the ranking algorithm, and
the surface translation. Nothing that requires the database to be reachable.

## Code Review Rules

### The four schema commitments are not negotiable

`vision.md` §9 was chosen against the M4 and M5 requirements, and the expensive parts are expensive
because they cannot be added later. Flag any change that erodes:

- **`actor_kind` as a first-class enum.** Not a nullable `user_id`, not a boolean. Rehydration reads
  it to decide what to trust; conflict resolution reads it to decide who arbitrates.
- **The bi-temporal columns** — `valid_from`, `valid_to`, `supersedes_id`, `superseded_by_id`. They
  answer "what did we believe on March 3rd", which is the M4 timeline and the M5 audit export.
  Retrofitting bi-temporality onto a store with real history is close to impossible.
- **`load_bearing`**, which decides whether a contradiction blocks or merely logs. §9 calls getting
  this right "most of the product quality."
- **`access_scope` as a hierarchy** — `private` → `project` → `team` → `workspace`, plus
  `restricted`. Widening a visibility model after real multi-team data exists is the same class of
  migration as retrofitting bi-temporality.

### Scope is enforced where rows are selected

A visibility check in a renderer leaks the moment the CLI, the MCP server, or an export reads the
same store. One filter, at the query layer. Flag a scope decision made anywhere else.

### Migrations are forward-only and refuse to half-apply

A runner meeting a store newer than the binary refuses to operate rather than partially applying.
Flag a migration that is not re-runnable, or one that drops a column carrying history.

### Attribution is what makes this a record rather than a cache

Every `context_item` write is attributable to a checkpoint through `checkpoint_item`, with the
correct `action` — `created`, `updated`, `superseded`, `rejected`. Flag a write that skips the link.
Checkpoint writes are atomic; an interrupted checkpoint leaves no partial state.

### One engine

Postgres and pgvector, hosted. There is no SQLite and no local store (§11.1, resolved 2026-07-28).
**A second storage backend is a `vision.md` change, not an implementation choice** — if a diff starts
one, that is the finding.

### The `conflict` table is the moat asset

It ships in M0 even though resolution is M4, because a detected conflict with nowhere to be recorded
is a training example we never get back. Flag detection paths that discard rather than record.
