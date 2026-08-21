# Mneia — Agent Instructions

Shared context for any coding agent in this repo: Claude Code, Cursor, Codex, Gemini CLI.
Claude Code loads this through the `@AGENTS.md` import at the top of `CLAUDE.md`.

**Then read the file for your harness, because this one deliberately does not carry it:**

| You are | Read next |
|---|---|
| Claude Code | `CLAUDE.md` — loaded for you |
| Codex | **`CODEX.md`** — including its warning that `.claude/rules/` does not auto-load for you |
| Cursor, Gemini CLI, anything else | `CODEX.md`, which is the harness-neutral of the two |

**And read `docs/BUSINESS.md`** before touching pricing, the waitlist, published copy, legal content,
or telemetry. `vision.md` is the authority but runs to 870 lines; `BUSINESS.md` is the subset that
stops a technically correct change from being a commercially wrong one.

<!-- Keep this file under ~150 lines. It loads into every session. Detail belongs in
     .claude/rules/ (path-scoped) or .claude/skills/ (on demand), never here. -->

## What Mneia is

The shared project memory and handoff layer for teams working with AI agents. Three operations:

- **Checkpoint** — capture decisions, constraints, and open questions at a task or day boundary
- **Rehydrate** — assemble the minimal high-signal context slice for the next task, under a token budget
- **Handoff** — produce a receivable artifact when work changes hands

Everything else serves those three.

**Read `vision.md` for the reasoning. Read `ROADMAP.md` for the plan.** Do not ask a human to
re-explain what is already in those files, and do not restate their content in this one.

## Current status

M1 (Core Loop — Checkpoint & Rehydrate) is the active milestone, Aug 4 – Sep 1. M0 closed. M1 is
carrying more than its name suggests: the 2026-07-29 ruling (§12.3) moved the web app (MNE-25) and
billing (MNE-26) into it, so it covers the core loop, the hosted API, the full web surface, and
Stripe. `ROADMAP.md` §M1 is the checklist; check it for which milestone a thing belongs to before
assuming an implementation is missing.

Most of the loop is real and deployed. `packages/core/src/store/` is at schema version 33, the CLI
ships twelve commands plus an interactive session, the MCP server ships ten tools, and extraction
runs against real sessions in production. Counts drift — read `SHIPPED_COMMAND_NAMES` in
`packages/cli/src/router.ts` and `SHIPPED_TOOL_NAMES` in `packages/mcp-server/src/registry.ts`
rather than trusting this sentence. Those two arrays are enforced: a command or tool registered but
missing from them is rejected, and in the MCP server's case it refuses to start at all.

**The core tables exist. Multi-tenancy is ruled.** §11.2 Q3 closed on 2026-07-31 (MNE-172): shared
schema, `workspace_id` on every row, Postgres RLS mandatory — see `vision.md` §11.3. Migrations
`0002` and `0003` implement it, so `workspace`, `actor`, `team`, `team_member`, `project`, `session`
and `context_item` are real, each with `ENABLE`/`FORCE ROW LEVEL SECURITY` and a workspace-isolation
policy keyed on a `mneia.workspace_id` session GUC.

**RLS is enforced in code, and its production posture is now observable.** MNE-186 landed: every
store — in `@mneia/core` and in `apps/web` — calls `assertConnectionEnforcesRls` inside its shared
transaction helper, so a connection holding `BYPASSRLS` or `SUPERUSER` is refused rather than
silently trusted. Do not take the old "RLS is inert in production" note at face value; it predates
that guard.

**Check it rather than assuming it**, in either direction:

```
curl -s https://app.mneia.dev/api/health
```

`rls` reports `enforced`, `bypassed`, `bypassed_by_escape_hatch`, or `unknown`. Anything other than
`enforced` means workspace isolation is not doing what §11.3 says it does. `MNEIA_ALLOW_RLS_BYPASS=1`
is for one privileged migration command and never for the application — see `deploy/web.env.example`,
which is the inventory of what the deployed app reads.

**The same endpoint reports whether a model key is set**, because the failure is otherwise
invisible: `extraction`, `extractionFallback` and `embeddings` each read `key_present` or `no_key`.
**`key_present` is not `working`** — health never calls the provider, so it cannot see a key that
authenticates and is out of credit. That is MNE-266, and it is still open; read the state as "a key
is set", never as "extraction works".

**The endpoint also classifies itself.** `capabilities.failing` lists the required capabilities that
did not come up and `capabilities.unconfigured` the advisory ones, so a reader does not have to know
which of a dozen fields matter. `deploy-web.yml` fails on `failing` and warns on `unconfigured`;
`health-watch.yml` runs every six hours and fails on either. Add a capability to `HealthReport` and
a test in `health.test.ts` fails until you classify it in `CAPABILITY_TIERS` — that is deliberate,
because `billing` was added to the report and never to the check, and sat `not_configured` through
three deploys after five people were invited (MNE-141).

**Both keys are set and funded as of 2026-08-08** (MNE-265), and `/api/health` reports `key_present`
for all three. Extraction is verified end to end against real sessions on this repo: a 1,357-turn
Claude Code session reduced from 1.31M to 700K characters and returned 7 candidates in 12.5s for
$0.05; an 18-turn session returned 1 for $0.0017.

**The keys are not on the droplet.** They are the `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`
repository secrets, which `deploy-web.yml` passes to the container. `/etc/mneia/web.env` still holds
everything else. Rotating a model key is `gh secret set` plus a re-run of the deploy — do not edit
the droplet, or the next deploy will overwrite what you wrote.

**That path is now lossless, and the old warning here was wrong for a week.** Both MNE-265 defects
are fixed; do not go looking for them:

- **The watermark no longer passes what was never sent.** `915685c` disabled the reducer cap on the
  server (`propose.ts`, `maxChars: Number.MAX_SAFE_INTEGER`), added `packages/core/src/extract/chunk.ts`
  so an oversized transcript is split rather than trimmed, and moved the watermark only after a chunk
  parses. `propose.test.ts` covers it.
- **Failover checks the window it is failing over to.** `contextTokens` **is** read — four sites in
  `apps/web/src/server/extraction/select.ts`, which refuses a fallback that cannot hold the prompt
  and says so. `select.test.ts` covers it.
- **The client stopped trimming too.** `bfd46bf` removed the 700,000-character cap from
  `packages/cli/src/http-api.ts`; a session larger than one request is uploaded across successive
  runs and the remainder is reported as pending rather than dropped.

**That last bullet was false for as long as it stood here, and MNE-100 found out why.** The
incremental path probes for the watermark by uploading no turns, and `CheckpointProposeWireSchema`
had `turns: ...min(1)` — so the API rejected the probe and an oversized session could not be
checkpointed at all. Nothing caught it because the fake server in `http-api.test.ts` never validated
against the real schema. The `.min(1)` is gone and `wire.test.ts` asserts the schema accepts an
empty upload. **Treat a fake that is more permissive than the schema it stands in for as a defect,
not a convenience.**

`mneia checkpoint` **sweeps every session discovered for the directory**, up to
`MAX_CHECKPOINT_SESSIONS`. It probes each one's watermark before uploading, so a session with
nothing new sends no transcript. `--session <ref>` still names one; `--all-sessions` is now just an
explicit spelling of the default.

One thing in that path is genuinely still open: `turnsSince` returns `resolved: false` when the
watermark is absent from the uploaded turns, and `propose.ts` ignores `resolved` — so **any partial
upload is treated as entirely new**, moving the watermark backwards and re-running extraction we pay
for. The CLI now always asks for the watermark first, on every session rather than only oversized
ones, but nothing in the server prevents it.

## Repo map

| Path | What it is |
|---|---|
| `vision.md` | Founding brief. The **why**. Sections are cited everywhere as §n. |
| `docs/BUSINESS.md` | Who pays, what the money is, and what we may never claim. Short, and binding. |
| `ROADMAP.md` | Milestones, the 132-item checklist, standing rules, Linear workflow |
| `CLAUDE.md` / `CODEX.md` | Harness-specific instructions. Same rules, different tooling. |
| `SKILLS.md` | Index of available skills |
| `AGENTS.md` §Code Review Rules | What Codex code review checks. Nested copies in `packages/core/` and `apps/site/`. |
| `docs/STACK.md` | Tooling choices and the ones still open |
| `.claude/rules/` | Topic rules, mostly path-scoped so they load only when relevant |
| `.claude/skills/` | Multi-step procedures, loaded on demand |
| `.claude/settings.json` | Permissions, env, hooks |

## Commands

These are real as of MNE-34/35/36. Keep this section current — a stale command list is worse than none.

```
pnpm install          # deps
pnpm build            # tsc --build across packages ONLY — does not typecheck apps/web or apps/site
pnpm -r build         # every workspace member, including next build for both apps — CI runs this
pnpm format:check     # CI runs this
pnpm lint:ci          # biome lint, errors only — CI runs this
pnpm check:policy     # branch, commit, and lane policy — CI runs this

pnpm test             # build, then vitest — local only, see below
pnpm typecheck        # tsc --build --force — local only
pnpm check:tests      # rejects committed .only / .skip / .todo — local only
pnpm format           # biome format --write
pnpm lint             # biome check — everything, warnings included
pnpm db:migrate       # apply pending migrations to DATABASE_URL — local, and both CI migrate paths
pnpm db:snapshot      # regenerate db/structure.sql from DATABASE_URL — run it with every migration
pnpm db:snapshot --check  # fail if db/structure.sql and the migrations disagree — CI runs this
pnpm db:version       # READ-ONLY: report the schema version a database is on, and applies nothing
pnpm waitlist:notify  # preview or send a waitlist campaign — local only, see below
pnpm check:publish    # refuse an npm publish that would fail or ship a broken manifest
pnpm changeset        # record a user-visible change against the client packages
pnpm version:packages # apply pending changesets: bump versions and write CHANGELOGs
pnpm release:dry      # changeset publish --dry-run
```

**Publishing to npm is automatic** (MNE-17, ruled by the founder 2026-08-17, replacing the earlier
manual-only rule). Merging a PR that carries a changeset makes `changesets/action` open or update a
**"Version Packages" PR** holding the bump and the CHANGELOG. **Merging that PR is the release** —
`release.yml` then runs `changeset publish` and tags. Nothing publishes straight off a feature merge,
so the version and changelog are always visible before they are public and, after 72 hours,
permanent. `workflow_dispatch` remains only to re-run a failed publish.

Do not "trigger a release". There is nothing to trigger — merge the version PR.

**Check the registry, never a package.json.** `npm view @mneia/cli version` was `0.7.1` on
2026-08-19, ahead of the `0.7.0` in the working tree — which is the normal state between a feature
merge and the version PR. That habit caught real drift twice; keep it. Note that a version number
alone is not proof of contents, nor that the package runs: `@mneia/mcp-server@0.7.0` published
unable to start at all. See the tarball check below.

## The version scale

Ruled by the founder 2026-08-18. **This is the repo's scale, and it overrides the instinct to reach
for semver's usual meanings.** Pick the changeset type by what the change *is*, not by what the word
sounds like:

| The change is | Choose | `0.4.0` becomes | Increment |
|---|---|---|---|
| A **milestone** — M1, M2, the shape of the product moving | `major` | `1.0.0` | to 1.00 |
| A **major update** — a new command, a new surface, a feature | `minor` | `0.5.0` | 0.1 |
| A **minor upgrade** — a fix, a polish, a doc-visible tweak | `patch` | `0.4.1` | 0.01 |

Verified against changesets 2.29.7 rather than assumed: at `0.x` a `major` really does go to `1.0.0`,
so **never write `major` unless a milestone is genuinely shipping.** It is a one-way door — npm
versions are immutable, and there is no route back from `1.0.0`.

The three client packages are `fixed` in `.changeset/config.json`, so they always move together; the
highest bump among pending changesets decides the release. `pnpm changeset` records one; a PR
touching the client packages needs one or the change ships with an incomplete changelog.

**`ci.yml` does not run tests or typecheck.** Ruled by the founder 2026-07-30: both were judged
noise. That job is format, lint errors, build, and git policy. It builds with `pnpm -r --if-present
build`, which runs `next build` for both apps as well as `tsc --build` for the packages, so a type
error anywhere still fails as a build failure.

**But the bare `pnpm build` does not.** The root script is `tsc --build`, and the root `tsconfig.json`
references only the three packages — so `pnpm build` typechecks zero app code and will happily go
green on a branch with type errors in `apps/web`. Run `pnpm -r build`, or `next build` in the app you
touched, before assuming the apps compile.

**But `database.yml` does run them** (MNE-203, approved 2026-08-01 as a narrow exception). It runs
the full suite with `MNEIA_REQUIRE_DB=1` — which turns a skipped integration suite into a failure
rather than a silent green. That is what makes the GUARD invariants real instead of decorative.

**Restructured 2026-08-02 by MNE-226**, after the project went over its Neon storage allowance —
0.53 of 0.5 GB against a database holding 17 MB of actual rows. The cause was this workflow: it ran
the whole suite *against a Neon branch*, and every integration file creates a schema, applies every
migration in the chain, and drops it. Neon retains that change history and bills it as storage. On
2026-08-02 it happened 34 times, mostly for documentation PRs.

Two workflows now, each doing only what it is for:

| Workflow | Runs when | Against | Does |
|---|---|---|---|
| `database.yml` | the store, integration tests, or migration scripts change | a throwaway `pgvector/pgvector:pg18` **service container** | the full suite, `MNEIA_REQUIRE_DB=1` |
| `neon_workflow.yml` | **`packages/core/src/store/migrations/**` changes** | a real Neon branch | applies migrations, posts a schema diff |

So the GUARD invariants no longer touch Neon at all — a service container is free and ephemeral, and
nothing is retained. Neon is reserved for what only Neon can do: applying a migration to a branch of
production and showing you the resulting diff.

A docs-only or `apps/site` PR now runs neither. **If you add code that can reach the store, add its
path to `database.yml`**, or the invariants stop being enforced for it.

Still run `pnpm test` yourself before opening a PR — the PR run is a backstop, not your first
feedback loop. It needs `DATABASE_URL`; without one the integration suites skip themselves.

**`pnpm test` builds first, on purpose.** The `cli` and `mcp-server` tests import `@mneia/core` by
package name, which resolves to `packages/core/dist` — so a clean checkout has nothing to import.
Do not remove the build from the `test` script without also fixing those imports.

## The database

Neon Postgres, hosted (`docs/STACK.md`). Copy `.env.example` to `.env` and put the connection string
in `DATABASE_URL` — `.env` is gitignored, and both `pnpm db:migrate` and `pnpm test` read it.

**Use the direct connection string, not the `-pooler` one.** The migration runner holds a session-level
`pg_advisory_lock` across the whole run, and Neon's pooled endpoint is PgBouncer in transaction mode,
where the server connection can change between statements. `.env.example` shows both.

**`db/structure.sql` is the schema the migrations add up to** (MNE-227) — generated, checked in, and
never edited by hand. It exists so a reviewer sees the resulting shape instead of replaying ten
migration files, and so a migration cannot land without the schema change being visible in the diff.
`database.yml` runs `pnpm db:snapshot --check` against a fresh container and **fails if the two
disagree**, which is also what catches an edited migration that has already been applied somewhere.

Write a migration, run `pnpm db:snapshot`, and commit both in the same commit.

A PR that **changes a migration** gets its own Neon branch — `.github/workflows/neon_workflow.yml`
creates `preview/pr-<n>`, applies migrations to it, posts a schema diff to the PR, and deletes the
branch when the PR closes. It skips fork PRs, which cannot see `NEON_API_KEY`, and since MNE-226 it
skips every PR that does not change a migration.

**Merging a migration to `main` applies it to production** (MNE-254). `.github/workflows/migrate-production.yml` runs
`pnpm db:migrate` against the production database, and `deploy-web` calls it as a job the ship step
depends on — so the order is migrate, then gate, then deploy, and a migration that fails stops
the deploy rather than letting it ship against a schema the build cannot satisfy. It resolves the
connection string from the Neon API at run time, so no second copy of the production credential is
stored anywhere.

It is dispatchable on its own from the Actions tab, because migrating and shipping are separate acts:
only the first is delegated. `pnpm db:migrate` by hand remains the fallback for when the workflow
cannot run, and it is still the only way to migrate anything that is not production.

The Postgres integration tests under `tests/integration/` need a real engine and **skip themselves
when `DATABASE_URL` is unset**. They create and drop their own `mne40_*` schemas, so they are safe to
point at a Neon branch. A local container also works:

```
docker run -d --name mneia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mneia \
  -p 5433:5432 pgvector/pgvector:pg18
DATABASE_URL='postgres://postgres:postgres@localhost:5433/mneia' pnpm test
```

An explicit prefix like that always wins over `.env` — `process.loadEnvFile` does not overwrite a
variable the environment already set.

## The waitlist

`apps/site` collects signups; `pnpm waitlist:notify <campaign>` is the only way to mail them.
It previews by default and sends nothing until you add `--send` — the same shape as `db:migrate`,
and for the same reason: there is no automatic path to a real person's inbox.

**Two published promises decide what may be sent, and neither is yours to relax.** The privacy
policy says the address is used for one thing, *"telling you when access opens"*, and the
confirmation email promises *"one more email … nothing else"*. So the list is **not** a newsletter.
Adding a campaign that is not the access announcement means changing `apps/site/src/content/legal.ts`
first, and that is a founder decision. The retention clause — deleted within 30 days of access
opening — is a live obligation too, not a statement of intent.

Every delivery is recorded in `waitlist_broadcast_send`, unique on `(campaign, signup_id)`. That
constraint, not the loop, is what stops a double send; re-running a campaign only reaches whoever
it missed. Unsubscribing hard-deletes the address and cascades its send history away with it.

## The nine standing rules

These come from `vision.md` and **override any individual ticket that contradicts them**.
Full text and rationale: `ROADMAP.md` §3.

1. **Never auto-supersede a human-confirmed item with an agent assertion.** §10.1 — the word *ever*
   is in the original. Needs a test, not a comment.
2. **Always include load-bearing active constraints in a rehydration slice**, regardless of score or
   budget pressure. §10.2. A dropped constraint is how the agent redoes the rejected approach.
3. **Human vs human conflicts are never auto-resolved.** §10.4 — *"silence here is how teams get burned."*
4. **`mneia_rehydrate` p95 stays under 300ms.** §12.1 — if it is slow, nobody calls it and the product fails.
5. **Every write path emits its §17 event.** Enforced by a test (MNE-51), not by convention.
6. **Privacy is enforced by controls, not by locality** — scope enforcement, retention, residency.
   §11.1 revoked MNE-50's "no content leaves the machine by default" on 2026-07-28, because
   hosted-only makes it untrue: see `vision.md` §11.1. **Do not restate the old promise** in a README,
   a package description, or anything public. MNE-50's live obligations are telemetry-scoped —
   opt-out, redaction, no content in events by default.
7. **Do not charge for the individual tier.** §14.
8. **Do not publish the handoff spec** until we own the reference implementation and the early adopters. §16.
9. **Do not build anything in §19.** Log the request and rule on it — see the `scope-check` skill.

## Non-goals

`vision.md` §19. If a request falls here, the answer is **no** unless the boundary has demonstrably moved:

agent orchestration or a runtime · observability, tracing, or evals · enterprise document search ·
a chat interface or an agent of our own · durable execution infrastructure · model hosting or
inference · a vector database (we use one) · support for every framework on day one

Run the `scope-check` skill before building anything that touches this list.

## Where you work — one worktree, start to finish

**Take a worktree when you start a task and stay in it until that task is done.** Not a worktree per
task — a worktree per agent, reused across tasks. `git worktree list` is the inventory; take one
that is idle rather than adding to the set. `docs/WORKSTREAMS.md` §0 names the lanes, but trust
`git worktree list` over that table when the two disagree.

**Never create a new one.** `.claude/hooks/worktree-guard.mjs` refuses `git worktree add` and the
`EnterWorktree` tool, and it is right to. Every new worktree is another full `pnpm install` and
another `node_modules` resolving this workspace independently — the drift between those trees is
where the dependency failures came from, and twenty stale worktrees were removed on 2026-08-16 for
exactly that reason. If your work genuinely fits no existing worktree, **say so and let the founder
decide** rather than creating one.

**Between tasks, rebase in place — do not relocate.** Finishing a task does not mean finding a new
worktree. Bring the one you are already in up to date and start the next task there:

```
git fetch origin
git checkout -b <next-branch> origin/main    # or: git rebase origin/main to continue on this one
```

That keeps the installed dependencies. Run `pnpm install` afterwards only if `pnpm-lock.yaml` moved.

**Leave no worktree dirty.** When you stop working — task finished, task handed over, or session
ending — `git status` in your worktree is empty. Everything is committed and pushed, or deliberately
discarded. Never abandoned. Uncommitted work in a worktree is invisible to every other agent and to
the founder, it survives no cleanup, and it is what made those twenty stale trees expensive to
remove. This applies to the primary checkout at the repo root too.

**Running low on usage? Commit first, then say so.** If the session's usage or context is running
out mid-task, do not stop with a dirty tree and do not quietly trail off. Commit what exists on the
task branch, push it, and tell the user plainly — something like:

> I have committed work in progress on `<branch>` because the session was running low on usage.
> This is a checkpoint, not a finished task. Still to do: …

Say it in the commit body as well, so the next agent reads it from `git log` rather than guessing.
A work-in-progress commit that admits what it is can be picked up. An uncommitted worktree cannot.

**The branch belongs to the directory, not to your session.** Another agent working the same
worktree can switch it under you between one command and the next. Re-check `git branch --show-current`
immediately before you commit, and stage explicit paths rather than `git add -A`.

## Session memory — use the product, the way a customer does

Ruled by the founder 2026-08-19. **Mneia carries context between sessions on this repo. Not a
markdown file, not a pasted summary, not the conversation you hope survives compaction.**
`docs/HANDOFF.md` was deleted in `2d78c62` for exactly this reason: writing a handoff file in the
repository of a handoff product is an admission the product does not work.

| Boundary | Do this |
|---|---|
| Session starts | `mneia_rehydrate`, or `mneia brief` — before planning, before writing code |
| A decision, constraint, or open question lands | `mneia_assert` at the moment it happens, not at the end |
| Session or day ends | `mneia_checkpoint`, or `mneia checkpoint` |
| Work changes hands | `mneia_handoff_create` / `mneia handoff`, picked up with `mneia_handoff_receive` / `mneia pickup` |

**Reach the product only through the surfaces a customer has** — the MCP tools or the `mneia` CLI.
Not `curl` against `/api/v1/*`, not a `psql` session against the store, not reading `handoff.rendered`
out of Postgres because it is faster. Those shortcuts work, and that is the problem: every one of
them steps over the exact code path a paying user cannot step over, and the bug hides in the step
you skipped.

**When the product cannot do the thing, that is the finding — not an obstacle to route around.**
File it and say so plainly. Reaching past a broken surface to finish your task converts a reportable
defect into a private workaround, and the next customer to hit it will not have your database
credentials.

This is not ceremony. Receiving one handoff on 2026-08-19 surfaced a defect inside a minute: its
Constraints section was full of doc fragments, because the interop importer (MNE-98) writes every
markdown bullet as a load-bearing constraint, and `isMandatoryItem` admits those ahead of the budget.
That was not visible from reading the code. It was obvious the moment the artifact had to be *used*.

**Two claims that sat here for a day were wrong, so do not carry them forward.** `assembleHandoff`
does have ranking and a budget — `assemble.ts` calls `scoreItems` then `packSlice` with a
3000-token budget and kind quotas. And §10.3 sets no item count; its example carries about thirteen.
The 2026-08-20 repair demoted eleven scraped fragments in production and measured the result through
`mneia handoff`: 47 items → 43, because the artifact is **token-bound, not item-bound** and the packer
refills from the queue. Shortening it is a product decision about length, not a bug fix — see MNE-98.

Two exceptions, and they are narrow. A **schema migration** goes through `pnpm db:migrate`, which is
an operator tool with no customer equivalent. A **one-off data repair** goes through a reviewed
script under `scripts/`, using the same scoped store the application uses, so RLS still applies —
never ad-hoc SQL. Anything else that wants to bypass the product needs the founder's ruling first.

## Working agreement

- **Linear is the source of truth for status.** Every unit of work starts by moving a ticket to
  `In Progress` and ends at `Done`. Team `Mneia`, prefix `MNE`. Procedure: `linear-ticket` skill.
- **A ticket is `Done` only when its own *Done when* clause is satisfied** — not when the code is
  written, not when it should work.
- **Work not in a ticket did not happen.** Found something? Create the ticket rather than doing it silently.
- **Cite `vision.md` sections as §n** in commits, PRs, and ticket comments. It is the shared shorthand.

## Code style

- **No comments unless asked.** Names and structure carry the meaning. Rationale goes in the ticket
  or the commit message, where it is searchable and dated.
- Match the conventions of surrounding code before introducing new ones.
- Never log or commit secrets, tokens, or user content.

## When you are unsure

1. Check `ROADMAP.md` for which milestone the work belongs to
2. Check `vision.md` for whether the question is already ruled on
3. Check the Linear ticket for its *Done when* clause
4. If it is a genuine fork with no default, **stop and ask** — do not guess and proceed

---

## Code Review Rules

Read by Codex code review, enabled in Codex settings. Nested `AGENTS.md` files add to this for the
code they sit beside — `packages/core/AGENTS.md` and `apps/site/AGENTS.md` today.

**CI already checks formatting, lint, the build, and git-lane policy. Do not repeat any of it.**
A review that suggests extracting a helper has cost more than it returned. Report only what you can
point at, with the file, the line, and a concrete failure — inputs or state, then the wrong outcome.
If you are unsure, say so in one clause. A confident wrong finding costs more than a missed one,
because the next review gets skimmed. Finding nothing is a result; say it in one line.

### Never let an agent overwrite a human

`human_confirmed` and `asserted_by` decide who is allowed to overrule whom, so a write path that
accepts either from its caller hands that decision to the caller. Actor kind is read from the
database, never from the payload. The supersede arbiter is the only place that decides.

Unsafe: a new store method taking `humanConfirmed` or `assertedBy` straight from an input object and
writing it. Safe: resolve the actor from the scope, read its kind from `actor`, and derive the flag.

### Never drop a load-bearing constraint from a slice

Any new filter, `LIMIT`, ranking change, or truncation step in the rehydration path must exempt
active constraints with `load_bearing = true`. They appear regardless of score or budget pressure —
a dropped constraint is how an agent redoes the approach a human already rejected.

### Every write path emits its §17 event

A new write with no event is a defect even when every test passes. The arbitration dataset is the
moat and it is not retrofittable — see `docs/BUSINESS.md`. Flag any store or service method that
creates, supersedes, rejects, or resolves without a corresponding emit.

### Do not restate promises we revoked

Self-hostability, offline operation, and "content never leaves your machine" were revoked as claims
on 2026-07-28 when the product became hosted-only (§11.1, §15). Flag any of them reappearing in a
README, a package description, marketing copy, a registry listing, or a comment. Privacy here is
enforced by controls — scope, retention, residency — not by locality.

### Treat `apps/site/src/content/legal.ts` as published, not as code

It renders the live Privacy Policy, Terms, and subprocessor table. If a diff changes a retention
period, a data-sharing statement, or that table, say so prominently and say whether it is now
accurate. **If the change adds a third party that touches user data and the subprocessor table is
untouched, that is a finding.**

The waitlist is not a newsletter: the policy commits the address to one use, telling people when
access opens, and the confirmation email promises "one more email … nothing else." Any new send
path, campaign, or removed send guard is a finding.

### Keep row-level security load-bearing

Every tenant row carries `workspace_id` and RLS is mandatory (§11.3). Flag a query that reads or
writes a tenant table without workspace scoping, a store method that bypasses `withScope`,
`MNEIA_ALLOW_RLS_BYPASS` anywhere outside a migration path, and anything that could cause the
application to connect as a role holding `BYPASSRLS` or `SUPERUSER`.

### Watch the 300ms budget

`mneia_rehydrate` p95 stays under 300ms (§12.1) — if it is slow nobody calls it and the product
fails. Flag added round trips in that path, N+1 queries, and `embedding` columns selected but never
read.

### Check the *Done when* clause, not the intent

The PR body names an `MNE-nnn`. A ticket is done when its own clause is satisfied — not when the
code is written and not when it should work. If the clause describes a journey a user can complete,
ask whether anything in the diff demonstrates it, and say plainly when nothing does.

### Scope

`vision.md` §19 lists what we do not build: agent orchestration or a runtime, observability or
evals, enterprise document search, a chat interface or an agent of our own, durable execution,
model hosting, a vector database. If a diff starts building one, name which one.

### Style, briefly

No code comments unless the ticket asked for them — rationale belongs in the commit message where
it is dated and searchable. No `any`, no non-null assertions, validate at trust boundaries. Domain
terms match §9 exactly: `context_item`, `load_bearing`, `human_confirmed`, `asserted_by`,
`valid_from`, `decay_after`. Errors name what was expected, what was received, and what to do.
