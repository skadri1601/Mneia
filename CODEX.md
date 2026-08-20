# Codex

Read `AGENTS.md` first — it is shared by every agent and carries what the project is, the nine
standing rules, the commands, and the working agreement. **This file is only the parts that depend on
which harness you are.** `CLAUDE.md` is the same file for Claude Code; where a rule appears in both,
it is the same rule and neither copy is authoritative over the other.

Read `docs/BUSINESS.md` before any change that touches pricing, the waitlist, published copy, legal
content, or telemetry. It is short, and it is the difference between a correct technical change and a
correct commercial one.

## You do not get the rules automatically

**This is the difference that will bite you.** `.claude/rules/` holds the detailed conventions —
architecture, data model, telemetry, testing, TypeScript style, MCP server, CLI, design. Claude Code
loads each of them automatically when a matching path is touched. **Nothing loads them for you.**

So before editing, open the one that matches:

| Editing | Read first |
|---|---|
| `packages/**` | `.claude/rules/architecture.md` |
| a migration, schema, or the store | `.claude/rules/data-model.md` |
| anything under `**/telemetry/**`, or adding an event | `.claude/rules/telemetry.md` |
| `**/*.test.ts` | `.claude/rules/testing.md` |
| any `.ts` or `.tsx` | `.claude/rules/typescript-style.md` |
| `packages/mcp-server/**` | `.claude/rules/mcp-server.md` |
| `packages/cli/**` | `.claude/rules/cli.md` |
| `apps/**`, `*.tsx`, `*.css` | `.claude/rules/design.md` — **and** `docs/design/apple.md` |

`.claude/rules/00-index.md` is the map. The directory is named for Claude only because Claude Code
got here first; the contents are not Claude-specific and they bind you exactly as much.

## Permission

The founder granted standing permission on 2026-07-28 to commit, push, and deploy in this
repository. Their role is review and direction, not typing. **Act on it** — do not stop to hand back
git commands you are authorised to run.

Two limits hold regardless:

- **No `Co-Authored-By` and no "Generated with …" trailers** in commit messages.
- **Never commit secrets**, `.env` files, or user content.

| Action | Allowed |
|---|---|
| Commit, push a feature branch, open a PR | Yes, without asking |
| Merge your own PR to `main` | Only after the founder reviews, unless they say otherwise |
| Deploy a preview | Yes |
| Deploy to production | **Ask first, every time** |
| `git push --force`, `reset --hard`, branch deletion, history rewriting | **Ask first, every time** |
| Apply migrations to the production database | **Yes, without asking** — see below |

Migrations were narrowed out of that list on 2026-08-19. **When production is behind, migrate it —
do not ask, and do not hand the command back.** MNE-254 made the deploy gate fail closed when
production's schema is older than the build, so an unapplied migration blocks every deploy in every
lane, not just the one that added it. Stopping to ask turns a thirty-second command into a stalled
pipeline for everyone.

**Since MNE-254, merging a migration to `main` applies it for you.**
`.github/workflows/migrate-production.yml` runs `pnpm db:migrate` against production, and `deploy-web`
calls it as a job `ship` depends on — migrate, then gate, then deploy. It is dispatchable on its own
with `gh workflow run migrate-production.yml`, which is the first thing to reach for when production
is behind, because it needs no credential on your machine.

By hand when that cannot run, or when the target is not production:

```
pnpm build          # db:migrate reads dist, not src
pnpm db:version     # where production actually is
pnpm db:migrate     # against the production DATABASE_URL
pnpm db:version     # confirm CURRENT before re-running the deploy
```

Report the version before and after. **Deploying to production is still ask-first** — migrating and
shipping are separate acts and only the first is delegated. A migration must also be safe under the
code currently running, because the gate permits only migrate-then-deploy.

If your sandbox or approval mode blocks something on this list, that is the harness being cautious,
not the founder withholding permission. Say what you were trying to do and let them decide — do not
route around it.

## Git lanes

Ruled 2026-07-29 (MNE-182). Enforced by `.claude/hooks/git-lane-guard.mjs` before a commit is made,
and again by the `policy` job in CI on every PR. Both read one definition, `scripts/git-lanes.mjs` —
change the lanes there, not in either caller.

| Lane | Contents | Flow |
|---|---|---|
| **Docs** | `*.md`, `docs/**`, `.claude/**`, `.github/**/*.md`, `LICENSE`, `NOTICE`, dotfile configs | **Commit direct to `main`.** No branch, no PR. |
| **Code** | Everything else — **plus `.claude/settings.json` and `.claude/hooks/**`**, which govern agent permissions and get reviewed like code | branch → commit → push → PR → report the URL |

**A commit touching both lanes is code lane.** Naming, because it is what links Linear:

- Branch `<type>/mne-<n>-<slug>` — types `feat fix docs chore refactor spike test`
- Commit subject `MNE-<n>: <imperative summary>`; several tickets `MNE-<n>, MNE-<m>: …`
- PR body contains `Closes MNE-<n>` or `Part of MNE-<n>`

The hook rejects any commit message with no `MNE-nnn`. No ticket yet? Create one first. Genuine
exception such as a revert: prefix `MNEIA_GIT_GUARD=off` and justify it in the commit body.

**The hook is a local git hook.** If you commit in an environment where it does not run, CI still
catches it — but you will find out at PR time instead of commit time, so check the naming yourself.

## Procedures

Claude Code loads these as skills. **You cannot invoke them; read the file and follow it.** They are
plain markdown and none of them depend on Claude-specific tooling.

| Read | When |
|---|---|
| `.claude/skills/linear-ticket/SKILL.md` | Starting or finishing any unit of work |
| `.claude/skills/scope-check/SKILL.md` | A request may touch a `vision.md` §19 non-goal |
| `.claude/skills/milestone-gate/SKILL.md` | A milestone is ending and its `GATE:` ticket needs running |
| `.claude/skills/db-migration/SKILL.md` | Adding or changing a table, column, or index |

`SKILLS.md` is the index.

## Code review

Codex code review is enabled through **Codex settings**, not through a workflow in this repo — there
is deliberately no `codex-review.yml`, because a second reviewer configured differently from the
built-in one is worse than either alone.

What it checks lives in **`## Code Review Rules`** at the bottom of `AGENTS.md`, plus nested copies
in `packages/core/AGENTS.md` and `apps/site/AGENTS.md` that apply to the code beside them. Both the
root rules and the nearest nested file apply to a changed path.

**Add rules there, not to a prompt file.** A rule earns its place by being consequential and
specific to this repository — CI already covers formatting, lint, the build, and git-lane policy,
and a review that repeats them trains people to skim.

## Before you start

Claude Code has a plan mode and is told to use it for schema changes, anything touching the §17
telemetry spine, and work spanning more than one Linear ticket. You have no such mode, so do the
equivalent explicitly: **for those three cases, write the plan into the Linear ticket and get it
agreed before writing code.** They are the places where a wrong turn is expensive to unwind.

Single-ticket work with a clear *Done when* clause: just build it.

## Session memory

Ruled by the founder 2026-08-19, and written up in full in `AGENTS.md` §"Session memory — use the
product, the way a customer does". The short version, because it binds you too:

**Mneia carries context between sessions on this repo.** Rehydrate before you plan, assert decisions
and constraints as they land, checkpoint at the end, and hand work over with a Mneia handoff. Not a
markdown file — `docs/HANDOFF.md` was deleted in `2d78c62` precisely because a handoff product whose
own team writes handoff files is not working.

**Use the surfaces a customer has.** You may not have the MCP server configured; the `mneia` CLI is
the customer path and it is enough — `mneia brief`, `mneia checkpoint`, `mneia handoff`, `mneia pickup`.
What you may not do is `curl` the API, open `psql` against the store, or read `handoff.rendered` out
of Postgres. Those shortcuts step over the code path a paying user cannot step over.

**If the product cannot do it, that is the finding.** File it and say so. Do not route around it —
the next customer to hit that surface will not have database credentials.

## Linear

**Linear is the source of truth for status**, team `Mneia`, prefix `MNE`. Every unit of work starts
by moving a ticket to `In Progress` and ends at `Done` — and a ticket is `Done` only when its own
*Done when* clause is satisfied, not when the code is written and not when it should work.

Claude Code reaches Linear, Sentry and Vercel through MCP servers. If you have those configured, use
them. If you do not, **say so** rather than guessing at ticket state or inventing a stack trace — and
do not silently fall back to a worse method.

## Testing before you open a PR

```
pnpm test        # builds first, on purpose — cli and mcp-server import @mneia/core by package name
pnpm lint:ci
pnpm format:check
pnpm check:policy
```

`pnpm test` needs `DATABASE_URL`; without one the integration suites skip themselves silently, which
looks like a pass. Use the **direct** Neon connection string, not the `-pooler` one — the migration
runner holds a session-level advisory lock across the run and Neon's pooled endpoint is PgBouncer in
transaction mode.

CI does not run tests. The Neon workflow does, on every non-fork PR, with `MNEIA_REQUIRE_DB=1`. Do
not treat that as your first feedback loop.

## When you are unsure

1. `ROADMAP.md` for which milestone the work belongs to
2. `vision.md` for whether the question is already ruled on
3. `docs/BUSINESS.md` if the question is commercial rather than technical
4. The Linear ticket for its *Done when* clause
5. If it is a genuine fork with no default, **stop and ask** — do not guess and proceed
