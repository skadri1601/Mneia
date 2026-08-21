# Schema scope — the whole store, settled in one pass

**MNE-253. Ruled by the founder 2026-08-07.** Schema version at the time: **14**.

This is the reference point for the data model. It reads every commitment already made —
`vision.md` §9/§11/§14/§17, the `ROADMAP.md` checklist through M5, the published legal copy, and the
nine standing rules — and lands **all** of it now, while the tables are empty, rather than
discovering requirements one panicked migration at a time.

**`vision.md` §9 is the spec and has been updated to match.** This document holds the reasoning; §9
holds the shape. If they ever disagree, §9 wins and this file is stale.

After this pass, schema changes come from customers and from measured need — not from re-reading the
brief.

---

## What was already there

14 migrations, 16 tables: the §9 model (`workspace`, `actor`, `team`, `team_member`, `project`,
`session`, `context_item`, `checkpoint`, `checkpoint_item`, `handoff`, `conflict`) with
`workspace_id` on every row and RLS forced, plus `api_token`, `device_authorization`,
`device_approval_attempt`, `waitlist_signup`, `waitlist_broadcast_send`, `mneia_schema_migration`.

§9 was implemented faithfully. Everything below is what §9 **did not cover** but the rest of the
brief requires.

---

## The eight rulings

### 1. Embeddings move to `context_item_embedding`; HNSW replaces ivfflat

Two defects, one fix.

**MNE-176 is open.** "Embedding vendor and dimensions" is an unresolved §11.2 decision, yet
`vector(1536)` was baked into `context_item` and into an index. A ruling for Voyage or Cohere (1024)
or Gemini (3072) meant `ALTER TYPE` on the hot table plus an index rebuild — on live data, during the
exact backfill §9 says is when the guarantee matters most.

**ivfflat was built on an empty table.** Old `db/structure.sql:210` — no `WITH (lists = ...)`, so it
took 100 centroids trained on zero rows. Recall stays poor until someone reindexes, and nothing in
the repo does.

`PRIMARY KEY (item_id, model)` means two models are **queryable at once**, which one column plus a
`CHECK` never could. `ON DELETE CASCADE` on the composite FK means retention never has to know
embeddings exist. And vectors leave the §12.1 read path structurally — MNE-215 solved that with a
`withEmbedding` flag, and a flag can be forgotten where a separate table cannot be selected by
accident.

`vector(1536)` stays for now; MNE-176 stays open. The table is what lets it stay open.

### 2. Full identity split

`actor_human_external_ref_unique` was **globally** unique, not per workspace, and
`postgres-account-store.ts:138` looked a human up by `external_ref` alone. One Clerk subject → one
actor → one workspace, enforced twice.

So: no second workspace, no contractor across two customers, no personal-plus-company. MNE-126
(invites), MNE-128 (cross-machine identity), and MNE-181 (workspace management) were all unbuildable
against that shape.

`identity` is the person; `actor` is that person **within one workspace**, so `asserted_by` stays
workspace-local and every provenance FK survives untouched. Doing this after real items exist means
rewriting the column §8.1 calls the difference between a record and a cache.

### 3. `context_item_grant`, so `restricted` stops being a lie

`access_scope` shipped five values including `restricted` — §9: *"an explicit grant list."* There was
no grant table, and `scope.ts:90` falls through to `false`, so `restricted` silently meant "invisible
to everyone but the asserter." The schema advertised a mode the query layer denied.

### 4. `telemetry_event` in Postgres, partitioned monthly

§17: *"This is the moat. It cannot be retrofitted, because a year of unlogged usage is a year of lost
training data."* §14.1: *"§17's event spine **is** the metering spine."*

**There was nowhere to put an event.** `packages/core/src/telemetry/sinks/` holds `jsonl`, `memory`,
and `remote` — and `remote` POSTs to `MNEIA_TELEMETRY_ENDPOINT`, which did not exist:
`apps/web/src/app/api/` had no telemetry route. In production the moat landed in a file on the
droplet, or nowhere.

`payload` carries ids, scores, and durations — **never content.** MNE-50's live obligation (§11.1) is
telemetry-scoped: opt-out, redaction, no content by default. `redact.ts` exists; this table must not
become a way around it.

### 5. `audit_event` separate from telemetry

Telemetry is opt-out and redacted under MNE-50. An audit log that can be opted out of or redacted is
not an audit log. Different guarantees, different retention, different table.

### 6. No Redis. Two Postgres tables, because abuse and billing are different jobs

**This ruling was corrected mid-pass.** The first version said no counter table at all — margin guard
in `workspace_usage_period`, burst limiting in process, justified by our running a single droplet.
That was wrong in one specific way, and the already-built `feat/mne-173-rate-limiting` branch was
right: an in-process bucket **resets on every deploy**, and we deploy by restarting a `docker
compose` service. A crash loop clears the abuse guard exactly when it is most needed. That branch's
`rate_limit_counter` also keys on `subject`, so it limits per token and per IP, not only per
workspace. With Neon on a paid plan the write-volume objection that motivated the original ruling is
much weaker too.

So both tables land, and they are not redundant:

| Table | Job | Why it cannot be the other one |
|---|---|---|
| `rate_limit_counter` | abuse control across all endpoints | needs per-subject keys and must survive restarts |
| `workspace_usage_period` | billing truth | must be incremented **inside the checkpoint transaction**, or the §14.1 allowance drifts from the checkpoints it is counting |

§14.1 still makes the checkpoint the only metered marginal cost, and the rollup is still a
materialised projection of `telemetry_event`, never a second source of truth.

**Still no Redis.** One droplet means no cross-instance coordination problem, and
`.claude/rules/architecture.md` needs no amendment. The trigger to revisit is a second app instance;
write it down then, do not pre-build it.

### 7. Retention columns land now; the `context_item` purge job does not run

| Promise | Source | Now |
|---|---|---|
| Waitlist address deleted within 30 days of access opening | published privacy policy, `apps/site/src/content/legal.ts` | **enforced since MNE-269** — `scripts/waitlist-purge.mjs`, run daily by `.github/workflows/purge-waitlist.yml`. Migration 0023 shipped `waitlist_signup_purge_idx` for this sweep and this line claimed the sweep existed. It did not, and saying so here is how a live obligation ran unwatched |
| Solo tier: 30-day history | §14 pricing table | column only |
| Privacy by controls: retention | §11.1 | column only |

`workspace.retention_days` and `context_item.purge_after` ship; the purge job that reads them stays
wired off until **MNE-103** rules the solo-tier policy. Deleting a customer's decision history on an
unsettled rule is the one class of bug with no undo. Shipping the column keeps the option; shipping
the deletion spends it.

`workspace.region` lands in the same migration — §14 sells residency to Enterprise, and keying a
region **after** multi-region data exists is a migration across regions, not a schema change.

### 8. Session rows retain client provenance without rewriting legacy history

MNE-86 exposed the difference between the Mneia integration surface and the client session it reads.
`session.tool` continues to name the integration, while `client_name`, `client_version`,
`client_session_ref`, `client_session_name`, and `client_session_url` retain the originating client's
identity and deep link. The columns are nullable and have no backfill: older rows and clients that do
not expose every field are valid, and context-item reads label them `partial` with the missing fields
instead of fabricating provenance.

---

## Everything landing

**`0015` and `0016` already exist.** `rate-limit-counter` (MNE-173) and `workspace-invitation`
(MNE-126) merged to `main` on 2026-08-07, taking the schema to version 16. This pass adapts to them
rather than renumbering finished, green work — see ruling 6 for the one place they changed a ruling.

Ordered by dependency; each is its own migration, all in one PR.

| # | Migration | Serves |
|---|---|---|
| 0017 | `identity`, `workspace_member`, `workspace_role`; drop global actor uniqueness; move `workspace_invitation` onto both | MNE-126, MNE-128, MNE-181 |
| 0018 | `context_item_embedding` + HNSW; drop `embedding`/`embedding_model` from `context_item` | MNE-176, MNE-215, MNE-73 |
| 0019 | `telemetry_event`, partitioned, + ingest route | §17 entirely, MNE-178, MNE-117 |
| 0020 | Checkpoint cost columns; checkpoint review state | MNE-180 → MNE-141, MNE-139, MNE-62 |
| 0021 | `conflict.rationale`, `context_item.supersede_reason` | MNE-134, MNE-90 |
| 0022 | `context_item_grant`; load-bearing partial index | MNE-127, MNE-146, standing rule 2 |
| 0023 | Retention columns, `workspace.region`, waitlist purge | published policy, §11.1, §14 |
| 0024 | `handoff_item` | MNE-92, MNE-90, MNE-96 |
| 0025 | `project_file_binding` | MNE-98/99/100 |
| 0026 | `workspace_usage_period` | MNE-103, MNE-178 |
| 0027 | `api_token.scopes` | MNE-146 |
| 0028 | `audit_event` | MNE-145 |
| 0031 | nullable client provenance on `session` | MNE-86, §9/§10 |

**The invite reconciliation happens in 0017, not on the MNE-126 branch.** `workspace_invitation`
shipped keyed on `team_id NOT NULL` and `team_role`, because `workspace_role` did not exist yet.
0017 introduces it, so 0017 is where the invite table moves onto workspace membership: `role` becomes
`workspace_role`, `team_id` becomes nullable, and accepting an invite writes a `workspace_member` row
always and a `team_member` row only when a team was named. That matches MNE-126's own title —
*"workspaces, invites, and membership"* — and it is the only ordering that does not require altering
a merged migration in place.

**Two of these are deliberately minimal.** `project_file_binding` and `audit_event` have no designed
behaviour behind them yet — MNE-98's import shape and the audit metadata contents are both
undecided. They carry the columns those decisions cannot avoid needing and nothing speculative.
Guessed columns get migrated anyway, which is the cost this pass exists to avoid.

Every migration needs `pnpm db:snapshot` in the same commit.

---

## Implementation notes that are easy to get wrong

**`identity` cannot use the standard RLS policy.** It is deliberately cross-workspace, so
`workspace_id = current_setting('mneia.workspace_id')` does not apply. Use the subject-keyed shape of
the existing `actor_identity_lookup` policy, which reads `mneia.identity_subject` and requires the
workspace GUC to be unset. It must still be `ENABLE`/`FORCE`, or `assertConnectionEnforcesRls` is
guarding a table with no policy.

**Storing grants is half the job.** `visibilityPredicate`
(`packages/core/src/store/scope.ts:31`) must gain a `restricted` disjunct and `canRead` at `:77` must
stop falling through to `false`. A grant table nothing reads leaves the value exactly as broken as it
was. Scope is enforced at the query layer, never in a renderer.

**Partitions do not create themselves.** A missing partition makes the INSERT fail, which loses
exactly the events the table exists to stop losing. Create a `DEFAULT` partition as a backstop **and**
a rolling creation job — the backstop alone is not enough, since rows landing in `DEFAULT` block
future partition attachment for that range.

**`database.yml` triggers on paths.** 0016 and 0017 add code that can reach the store; if their paths
are not in that workflow's trigger list, the GUARD invariants stop being enforced for them.

---

## Not to be built

Each already ruled on:

| Idea | Ruling |
|---|---|
| A tag / topic / subject axis on `context_item` | §9: *"Deliberately not modelled… speculative until a real case demands it"* |
| A graph table for multi-hop reasoning | §11: premature; bi-temporal columns plus `supersedes` links cover it |
| An escalation object or approval state machine for scope changes | §9: *"Scope is ratified, never routed"* |
| A second storage engine, SQLite, or a local store | §11.1, resolved 2026-07-28 |
| A vector database | §19 non-goal |
| Redis, or any second runtime dependency | MNE-253, 2026-08-07 — one droplet, and the margin guard is transactional |

---

## Still open after this pass

1. **MNE-176 — embedding vendor and dimensions.** `context_item_embedding` is built so this can stay
   open. It cannot stay open past the first backfill.
2. **MNE-103 — the solo-tier retention policy** gates turning the `context_item` purge job on. The
   columns ship; the deletion does not run until the rule is ruled.
