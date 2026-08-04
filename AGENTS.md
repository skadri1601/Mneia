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

M0 (Foundations & Instrumentation) is the active milestone. Implementation has started: the
migration runner and schema versioning landed with MNE-40, so `packages/core/src/store/` is real.
Almost everything else is still ahead — if you are looking for an implementation and cannot find it,
that is expected. Check `ROADMAP.md` for which milestone it belongs to before assuming it is missing.

**The core tables exist. Multi-tenancy is ruled.** §11.2 Q3 closed on 2026-07-31 (MNE-172): shared
schema, `workspace_id` on every row, Postgres RLS mandatory — see `vision.md` §11.3. Migrations
`0002` and `0003` implement it, so `workspace`, `actor`, `team`, `team_member`, `project`, `session`
and `context_item` are real, each with `ENABLE`/`FORCE ROW LEVEL SECURITY` and a workspace-isolation
policy keyed on a `mneia.workspace_id` session GUC.

What is genuinely still ahead: MNE-43 (`checkpoint`, `checkpoint_item`, `handoff`, `conflict`),
MNE-44 (the store adapter) and MNE-169 (scope enforcement). **RLS is currently inert in production**
— the role in `DATABASE_URL` holds `BYPASSRLS`, so MNE-186 has to land before any tenant data does.

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
pnpm db:migrate       # apply pending migrations to DATABASE_URL — local and the Neon workflow
pnpm db:snapshot      # regenerate db/structure.sql from DATABASE_URL — run it with every migration
pnpm db:snapshot --check  # fail if db/structure.sql and the migrations disagree — CI runs this
pnpm waitlist:notify  # preview or send a waitlist campaign — local only, see below
```

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
the whole suite *against a Neon branch*, and every integration file creates a schema, applies all
ten migrations, and drops it. Neon retains that change history and bills it as storage. On
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
skips every PR that does not change a migration. **That workflow is the only thing that runs
migrations automatically; nothing migrates production.** Applying to production is a deliberate
`pnpm db:migrate` against the production `DATABASE_URL`, and `CLAUDE.md` requires asking first.

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
