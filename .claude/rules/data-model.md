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

**§9 was completed in one pass on 2026-08-07 (MNE-253).** Everything the brief, the roadmap through
M5, and the published legal copy imply is now in the schema, landed while the tables were empty.
`docs/SCHEMA-SCOPE.md` holds the reasoning for each piece and the two decisions still open.

So the bar for a new table or column has moved: **it comes from a customer or a measurement, not from
re-reading `vision.md`.** If you think §9 is missing something, check `SCHEMA-SCOPE.md` first — it
was probably considered and either landed or deliberately refused.

## The company is the unit

Revised 2026-07-28: Mneia is architected for a **medium-sized company** — 50–500 people, 5–20 teams, several functions — from the first migration, not from month 18. That means `team`, `team_member`, and a five-value `access_scope` hierarchy ship in M0 alongside everything else.

`project` is a **body of work, not a repo**. `repo_url` stays nullable so a sales team's "Q3 enterprise motion" is as valid a project as a backend service. Do not add a NOT NULL constraint to it.

## Four things that are not negotiable

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

**4. `access_scope` is a hierarchy, and scope is ratified rather than routed.**
`private` → `project` → `team` → `workspace`, plus `restricted`, whose grants live in `context_item_grant`. Widening a visibility model after real multi-team data exists is the same class of migration as retrofitting bi-temporality — it does not go well.

`restricted` is only real if the query layer reads the grants. `visibilityPredicate` and `canRead` in `packages/core/src/store/scope.ts` are the two places; a grant table nothing reads is a visibility mode the schema advertises and silently denies.

**5. `identity` is the person; `actor` is that person inside one workspace.**
Never look a human up by `external_ref` alone — that was the bug MNE-253 fixed, and it silently capped every person at one workspace. Uniqueness is `(workspace_id, external_ref)`. `asserted_by` points at an actor, so provenance stays workspace-local; anything that would make it point at an identity is a change to §8.1's record-not-cache guarantee.

**6. Vectors live in `context_item_embedding`, one row per `(item, model)`.**
Do not add an `embedding` column back to `context_item`. The side table is what keeps two models queryable during a backfill and what keeps vectors off the §12.1 read path without depending on a filter flag. Index with HNSW, not ivfflat — ivfflat trains on build, and building against an empty table trains on nothing.

---

The extractor **suggests** a scope; the human confirms or overrides it at checkpoint, exactly as with `load_bearing`. Promoting an item to company-wide is a scope change with provenance, **not** an approval workflow. Do not build an escalation object, a state machine, or a notification pipeline for this — every one of those serves none of checkpoint, rehydrate, or handoff (§4), and the override itself is a labelled example for §17.

## One engine

**Postgres + pgvector, hosted. There is no SQLite and no local store** (§11.1, resolved 2026-07-28).

That removes engine parity as a concern entirely — no dual adapters, no `sqlite-vec` versus
`pgvector` ranking divergence, no parity test. If you find yourself writing a second storage backend,
stop: that decision was made and reversing it is a `vision.md` change, not an implementation choice.

Migrations are versioned and forward-only. A runner that meets a store newer than the binary must
refuse to operate rather than half-apply.

## Writes

- Every `context_item` write is attributable to a checkpoint via `checkpoint_item`, with the correct
  `action`: `created` / `updated` / `superseded` / `rejected`. Attribution is what makes this a
  record rather than a cache (§8.1 rule 1).
- **Scope is enforced at the query layer, never in a renderer.** A visibility check that lives in the
  web app leaks the moment the CLI, the MCP server, or an export reads the same store. One filter,
  applied where rows are selected.
- Checkpoint writes are atomic. An interrupted checkpoint leaves no partial state.
- Every write emits its §17 event — see `telemetry.md`.

## The `conflict` table

Ships in M0 even though resolution is M4. §10.4: **"This table is the moat asset."** Detection starts
in M1, and a detected conflict with nowhere to be recorded is a training example we never get back.
