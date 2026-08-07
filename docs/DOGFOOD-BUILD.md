# Dogfood build — coordination

**Goal:** one person (the founder) uses Mneia daily on real work at Ascend for a month, in Claude Code,
Cursor and Claude Desktop. That is M1's own success test — *"the founder uses it daily and does not
turn it off."*

**Status: the store binding landed in PR #60 (2026-08-05), verified green on a real Postgres 18 container — 1020 tests, none skipped.** The paragraph below describes the state before it.

**Was: nothing ran.** Every CLI command rejects with *"the hosted Mneia API client is not
wired into this build yet"*. The MCP server initialises, advertises all four tools with full schemas,
then returns `store_unavailable` on every call. Verified by driving the checked-in builds over stdio,
not by reading them.

**The fix is not the hosted API.** MNE-101 is marked as blocking the CLI, the MCP server and the
dogfood. For a solo month it blocks none of them. Everything real is already built — store adapter,
RLS guard, supersede arbiter, scorer, packer, redacting emitter, the CLI review loop. They are
separated by exactly two unimplemented seams:

- `createContextProvider` — `packages/mcp-server/src/bin.ts:97`, a closure whose only statement is `throw`
- the CLI's five `*Api` interfaces, all resolving to a stub

Bind both to `PostgresStoreAdapter` over a `NOBYPASSRLS` role. Keep the binding **behind the existing
interfaces** so the HTTP implementation drops in later without touching tool logic.

> This file replaces Linear tickets for coordination during this build. Linear is still the status
> source of truth for the project as a whole — this is the working surface for three agents moving at
> once. **Update the status board in the same commit as the work.**

---

## How to use this file

Three lanes run in parallel. **Do not edit files outside your lane** — that is the whole mechanism
preventing merge conflicts, because the work concentrates in very few files.

1. Find your lane below
2. Read *The contract* — lanes 2 and 3 code against it before lane 1 implements it
3. Read *Three things that must not be reintroduced* — every one of them is a silent failure
4. Tick your rows on the status board as you land them

**Codex:** `.claude/rules/` does not auto-load for you. Read `CODEX.md`, and for this work read
`.claude/rules/typescript-style.md` and `.claude/rules/data-model.md` directly.

### Branch off lane 1 until PR #59 lands

The core re-export that lanes 2 and 3 need is in **PR #59**, not yet on `main`. Until it merges,
branch from `feat/mne-44-local-store-binding` rather than `main`, or `import { PostgresStoreAdapter }
from '@mneia/core'` will not resolve.

### Run tests against a local container, not Neon

`pnpm test` with the `DATABASE_URL` from `.env` runs the integration suite against Neon over the
network — **645 seconds** for a full run, measured 2026-08-04. The same suite takes ~27s on a
container. Three lanes iterating against Neon is also the storage problem MNE-226 fixed for CI and
never fixed for local development.

```
docker run -d --name mneia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mneia \
  -p 5433:5432 pgvector/pgvector:pg18
DATABASE_URL='postgres://postgres:postgres@localhost:5433/mneia' pnpm test
```

An explicit prefix always wins over `.env` — `process.loadEnvFile` does not overwrite a variable the
environment already set.

---

## Status board

Update the marker and add the PR or commit. `[ ]` not started · `[~]` in progress · `[x]` landed.

### Lane 1 — store (owner: Claude session 1)

| | Item | Files | Notes |
|---|---|---|---|
| `[x]` | Re-export `PostgresStoreAdapter` + `StoreError` | `packages/core/src/index.ts` | **PR #59.** Verified by resolving `@mneia/core` by package name from inside `packages/mcp-server`, not by relative path — the exports map was the blocker. Also fixed there: Biome rejecting in-repo worktrees as nested root configs, which broke `format:check` and `lint:ci` locally for every parallel session; and `.claude/worktrees/` now gitignored |
| `[x]` | `NewProject` + `ConfirmContextItemInput` types | `store/adapter/types.ts` | **Land first, alone.** Unblocks lanes 2 and 3 |
| `[x]` | `createProject` on `ScopedStore` + adapter | `store/adapter/types.ts`, `postgres.ts` | No path in shipped source creates a project row |
| `[x]` | `confirmContextItem` on `ScopedStore` + adapter | `store/adapter/types.ts`, `postgres.ts` | No update method exists at all |
| `[x]` | `decay_after` in the INSERT column list | `postgres.ts:525-529` | Column exists (`structure.sql:147`), adapter omits it |
| `[x]` | Bootstrap script | `scripts/` (new) | workspace · human actor · **agent actor** · team · project · `~/.mneia/local.json` |

### Lane 2 — MCP surface (owner: Claude session 2, in a worktree)

| | Item | Files | Notes |
|---|---|---|---|
| `[x]` | Replace the throwing context provider | `mcp-server/src/bin.ts:97` | Build `PostgresStoreAdapter` from `~/.mneia/local.json`, return `withScope({workspaceId, actorId: <AGENT actor>})` |
| `[x]` | Local mode in config | `mcp-server/src/config.ts:148` | Currently exits 1 on missing `MNEIA_TOKEN` and tells the user to run `mneia login`, which does not exist |
| `[x]` | Thread `createJsonlSink` into `ToolContext` | `bin.ts`, `tools/types.ts` | **Not** `sinks: []` at `bin.ts:89` — that emitter is only used for flush/close at `server.ts:230`. Tools emit through `context.telemetry` |
| `[x]` | Call `createSession` when building the context | `bin.ts` | `createSession`/`endSession` have zero callers; every item lands with null session provenance |
| `[x]` | `sliceId` + `referencedItemIds` on `mneia_checkpoint` | `tools/checkpoint.ts` | Emits `item_referenced` / `item_ignored`. **Day 1 or the first week is unreconstructable** |
| `[x]` | Route load-bearing candidates somewhere real | `tools/checkpoint.ts:306` | Currently `pendingForLoadBearing`, returned in the response and written nowhere. See *Open decisions* |

### Lane 3 — everything else (owner: Codex)

| | Item | Files | Notes |
|---|---|---|---|
| `[ ]` | `.mcp.json` + SessionStart hook + `AGENTS.md` fence | repo root, `.claude/` | Only trigger today is the prose string at `server.ts:19`. This decides whether the habit forms |
| `[ ]` | `pg_dump` backup script + delete recipe | `scripts/`, `docs/` | Zero `DELETE` against any tenant table exists in source |
| `[ ]` | Correct `AGENTS.md` | `AGENTS.md:48-49` | Says RLS is inert in production and MNE-44/169/186 are ahead. All three are **Done**; the guard is called at `postgres.ts:809` |
| `[ ]` | Correct published docs | `apps/site/src/content/docs.ts` | `:115` claims the whole surface is built · `:154` advertises an npm install that 404s · `:169/176/251/726` document `mneia login` as shipped |
| `[ ]` | Triage the 30 tickets in `In Progress` | Linear | `ROADMAP.md` §0.2 forbids parking work there |

### Gate — before the first byte of Ascend content

| | Check | Pass condition |
|---|---|---|
| `[ ]` | `SELECT human_confirmed, count(*) FROM context_item GROUP BY 1` | Everything written via MCP is `false`. **If any agent write is `true`, stop** — see killer 1 |
| `[ ]` | `wc -l ~/.mneia/events.jsonl` | Non-zero |
| `[ ]` | `mneia checkpoint` run interactively **on the work laptop** | Completes. `prompt.ts:42-125` raw-mode handling has zero test coverage and Windows is where it differs most |
| `[ ]` | Backup script run once, restore verified | Restores |

---

## The contract

Lane 1 lands this **first and alone**. Lanes 2 and 3 then code against it while lane 1 implements it
underneath. Signatures verified against `db/structure.sql` — note `project.display_name`, not `name`.

```ts
export interface NewProject {
  readonly id?: Uuid;
  readonly slug: string;
  readonly displayName: string;
  readonly teamId?: Uuid | null;
  readonly repoUrl?: string | null;
}

export interface ConfirmContextItemInput {
  readonly id: Uuid;
  readonly confirmedBy: Uuid;
  readonly loadBearing?: boolean;
  readonly accessScope?: AccessScope;
  readonly title?: string;
  readonly body?: string;
}

export interface ScopedStore {
  createProject(input: NewProject): Promise<Project>;
  confirmContextItem(input: ConfirmContextItemInput): Promise<ContextItem>;
}
```

`repo_url` stays nullable — a project is a body of work, not a repo (`.claude/rules/data-model.md`).

`confirmContextItem` carries `loadBearing` and `accessScope` because the human confirms or overrides
both at checkpoint. It is an `UPDATE`, and that is already proven safe: the RLS policy on
`context_item` (`migrations/0003:61`) has no `FOR` clause, so it defaults to `FOR ALL`, and
`linkSupersession` (`postgres.ts:540`) already updates that table under it. **No migration is needed
anywhere on this critical path** — which is why there is no Neon workflow and no schema snapshot in
this build.

---

## Three things that must not be reintroduced

Each lets the product look like it works while destroying what the month exists to produce.

**1 · Agent writes must never land `human_confirmed = true`.**
`assert.ts:194` and `checkpoint.ts:217` both derive it from `actor.kind === 'human'`. Nothing in the
repo has ever created an actor with `kind='agent'` — the only such literals in shipped source are enum
definitions. If the MCP connection resolves to the founder's human actor, standing rule 1 is defeated
by construction, an agent can supersede anything, and the arbitration labels are poisoned
irreversibly. Lane 1 creates the agent actor; lane 2 scopes the connection to it.

**2 · The review queue must not end up empty.**
It is populated by `needsHuman()` = `loadBearing || supersedes !== null`, and `emitReviewEvents`
(`checkpoint.ts:374`) iterates **only** the reviewed set — automatic candidates emit no
confirmed/edited/rejected event at all. So "fix" the load-bearing dead end by writing candidates as
`loadBearing=false` and every item becomes automatic, nobody is ever prompted, and the month produces
context rows with zero labels.

**3 · `item_referenced` ships day 1, not later.**
`slice_shown` already carries `sliceId`, `itemIds` and `durationMs`, so the JSONL gives the north-star
denominator and the 300 ms p95 measurement for free. The numerator does not exist, and slices are
never persisted (`rehydrate.ts:246` mints a UUID for an object written nowhere). Defer it a week and
that week can never be reconstructed. Treat the ratio as a **floor** — it is agent self-report — and
pair it with the week-4 withdrawal test.

---

## Commits

The lane guard (`.claude/hooks/git-lane-guard.mjs`) rejects any commit without an `MNE-nnn`. Use the
tickets that already exist rather than creating new ones:

| Work | Ticket |
|---|---|
| Store adapter surface, `createProject`, `confirmContextItem` | `MNE-44` |
| `decay_after`, `context_item` hardening | `MNE-42` |
| Human confirmation flow, review queue | `MNE-62` |
| MCP context provider, stdio transport | `MNE-74` |
| JSONL sink wiring | `MNE-49` |
| `sliceId` / `referencedItemIds`, reference detection | `MNE-72` |
| `.mcp.json`, hooks, install config | `MNE-80` |
| Docs and `AGENTS.md` corrections | docs lane — commit direct to `main`, no PR |

Code lane is branch → commit → push → PR. Docs lane commits straight to `main`. A commit touching both
is code lane. Lanes 1 and 2 are code; lane 3 is mostly docs except the scripts.

---

## Open decisions

**What class of item should interrupt the founder?** Blocks lane 2's load-bearing routing.
Recommendation: **load-bearing + superseding** — which is what `needsHuman()` already implements. The
bug is only that load-bearing candidates never reach it. Alternatives are everything load-bearing
(noisier) or a confidence threshold (quieter, but constraints enter unconfirmed).

**Which database does the dogfood point at?** Recommendation: a Neon project separate from the one
`app.mneia.dev` uses, provisioned with `pnpm db:migrate` then `pnpm db:provision-app-role --apply`.
Never set `MNEIA_ALLOW_RLS_BYPASS`. Deleting that project is the kill switch.

---

## Cut — do not build these

| Cut | Consequence, accepted |
|---|---|
| Hosted API (`MNE-101`), `api.mneia.dev` | None for solo. Keep the interfaces as seams |
| `mneia login`, device flow, token issuance | Fix the error strings pointing at it (`cli/src/config.ts:138,144,150`) |
| npm publishing | Build from source. Mandatory the day a teammate gets it |
| `mneia init` | **Cut entirely** — it writes `.mneia/config.json` into the working tree and rewrites a fence in the repo's `AGENTS.md`. Gitignored here, *not* in Ascend's repo. Bootstrap writes `~/.mneia/local.json` instead |
| Web decision browser, review queue, timeline | CLI review loop is the human surface. `apps/web`'s stores contain no query against `context_item` at all |
| Teams, seats, billing | One tenant. The pitch cannot end with "join my workspace" — no mechanic exists |
| Trajectory reader + LLM extraction (`MNE-57/58`) | `mneia_checkpoint`'s schema says it does not read the transcript — the host model extracts. Claude Code does it |
| Embeddings, semantic ranking | Ranking is recent + confident + confirmed; `semanticRelevance` pinned at a constant. **Top day-10 risk** — instrument, revisit week 3 |
| Conflict detection and resolution UI | Rule 3 unreachable with one human. When a decision reverses, nothing notices. Mitigate by having the agent pass `supersedesId` |

---

## Known issues worth fixing if the signal says so

- **`actorTeamIds` memoises the resolved value, not the promise** (`postgres.ts:233-241`) — three
  concurrent `selectContextItems` each re-fire the same `SELECT team_id FROM team_member`. Rehydrate
  issues roughly ten sequential round trips on one session; `Promise.all` at `rehydrate.ts:198`
  parallelises none of them because a pg client serialises its queue. Three-line fix. Measure first —
  `durationMs` is in every `slice_shown`.
- **Neon scale-to-zero cold start** lands on the call made first every morning. If it dominates, keep
  the compute warm rather than rewriting queries.
- **Silent telemetry loss** — `emitQuietly`/`emitBestEffort` swallow every failure, and `jsonl.ts:105`
  unrefs its flush timer, so a short-lived CLI process that exits without `close()` drops buffered
  events. Wire `onError` to stderr and call `close()` on CLI exit paths.
- **Project identity friction** — `assert` and `checkpoint` require a UUID `projectId` while
  `rehydrate` and `search` accept a slug, so the agent must call rehydrate purely to harvest an id
  before it can write anything.
