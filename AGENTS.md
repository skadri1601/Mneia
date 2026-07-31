# Mneia — Agent Instructions

Shared context for any coding agent in this repo: Claude Code, Cursor, Codex, Gemini CLI.
Claude Code loads this through the `@AGENTS.md` import at the top of `CLAUDE.md`.

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

**The schema itself is not written yet, and is blocked.** MNE-41/42/43 create the §9 tables, and
§11.2 Q3 (multi-tenancy: shared tables filtered by `workspace_id`, schema-per-tenant, or RLS —
MNE-172) has to be ruled on first. Do not start those tables before that closes.

## Repo map

| Path | What it is |
|---|---|
| `vision.md` | Founding brief. The **why**. Sections are cited everywhere as §n. |
| `ROADMAP.md` | Milestones, the 132-item checklist, standing rules, Linear workflow |
| `SKILLS.md` | Index of available skills |
| `docs/STACK.md` | Tooling choices and the ones still open |
| `.claude/rules/` | Topic rules, mostly path-scoped so they load only when relevant |
| `.claude/skills/` | Multi-step procedures, loaded on demand |
| `.claude/settings.json` | Permissions, env, hooks |

## Commands

These are real as of MNE-34/35/36. Keep this section current — a stale command list is worse than none.

```
pnpm install          # deps
pnpm build            # tsc --build across packages — CI runs this
pnpm format:check     # CI runs this
pnpm lint:ci          # biome lint, errors only — CI runs this
pnpm check:policy     # branch, commit, and lane policy — CI runs this

pnpm test             # build, then vitest — local only, see below
pnpm typecheck        # tsc --build --force — local only
pnpm check:tests      # rejects committed .only / .skip / .todo — local only
pnpm format           # biome format --write
pnpm lint             # biome check — everything, warnings included
```

**CI does not run tests or typecheck.** Ruled by the founder 2026-07-30: both were judged noise.
CI is format, lint errors, build, and git policy. `pnpm build` is `tsc --build`, so a type error
still fails CI as a build failure — but nothing runs the test suite automatically. **Run `pnpm test`
yourself before opening a PR**, especially on anything touching `packages/core/src/store/`.

**`pnpm test` builds first, on purpose.** The `cli` and `mcp-server` tests import `@mneia/core` by
package name, which resolves to `packages/core/dist` — so a clean checkout has nothing to import.
Do not remove the build from the `test` script without also fixing those imports.

The Postgres integration tests under `tests/integration/` need a real engine and **skip themselves
when `DATABASE_URL` is unset**. To run them locally:

```
docker run -d --name mneia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mneia \
  -p 5433:5432 pgvector/pgvector:pg17
DATABASE_URL='postgres://postgres:postgres@localhost:5433/mneia' pnpm test
```

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
6. **No code or conversation content leaves the machine by default.** MNE-50.
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
