# Contributing to Mneia

Thanks for looking. Before you write code, read the section below — it will save you building
something we have to reject.

## The open/closed boundary

Mneia is **not** a single open-source product. It is an Apache 2.0 client against a proprietary
hosted service, and the line runs down the middle of the system.

**Open, Apache 2.0, in this repository:**

| Package | What it is |
|---|---|
| `@mneia/core` | Schema definitions, the handoff format, the extraction prompts, the rehydration ranking algorithm |
| `@mneia/cli` | `mneia` command-line surface |
| `@mneia/mcp-server` | MCP server exposing the tools to Claude Code, Cursor, Codex, and any MCP client |

**Proprietary, and not in this repository:** the hosted API, the store, multiplayer, conflict
resolution UI, permissions and roles, audit and governance, and the web app.

**The clients require an account and do not function without the hosted service.** We would rather
say that plainly than have you discover it after cloning. Mneia is **not self-hostable** today; that
becomes true for enterprise customers when BYOC ships, and not before.

So: a PR that improves extraction quality, ranking, the handoff format, a CLI ergonomic, or MCP
client compatibility is squarely in scope. A PR that adds a storage backend, a sync mechanism, an
auth server, or a web UI is not — not because it is unwelcome work, but because it belongs on the
other side of the line and we cannot merge it here.

## Things that are deliberately not on the roadmap

These get declined on sight, and it is nothing personal — each one turns Mneia into a different,
worse product. The reasoning is in `vision.md` §19.

Agent orchestration or a runtime · observability, tracing, or evals · enterprise document search · a
chat interface or an agent of our own · durable execution infrastructure · model hosting or inference
· a vector database (we use one) · support for every framework on day one

If you think one of these boundaries has genuinely moved, open an issue arguing the case rather than
a PR implementing it. We keep a written log of those rulings, and a good argument can move a line.

## Getting set up

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

`pnpm lint` and `pnpm format` are available and worth running, though only `format:check`,
`typecheck`, and `test` gate CI.

Node 20.11+ is required. The CI matrix runs 20 and 22.

## How we work

**Every change starts with an issue.** Work that is not tracked did not happen, as far as anyone
reading the project in six months is concerned — which is, not coincidentally, the exact problem this
product exists to solve.

**Two lanes for changes:**

| Lane | What | How |
|---|---|---|
| **Docs** | `*.md`, `docs/**`, `.claude/**` | Commit direct to `main` |
| **Code** | Everything else | Branch, then a PR |

Branches are `<type>/<issue-ref>-<slug>` with type one of `feat` `fix` `docs` `chore` `refactor`
`spike` `test`. Commit subjects lead with the issue reference. PR bodies say which acceptance
criterion they satisfy.

## Code style

- **No comments unless they are load-bearing.** Names and structure should carry the meaning.
  Rationale belongs in the commit message or the issue, where it is searchable and dated.
- Match the conventions of the code around you before introducing new ones.
- TypeScript is strict, and that includes `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Do not loosen them locally to make something compile.
- **Never log or commit secrets, tokens, or user content.**

## Two invariants that are enforced by tests, not review

If a change breaks either of these, the test failure is correct and the change is wrong:

1. **A human-confirmed item is never auto-superseded by an agent assertion.** Ever.
2. **Load-bearing active constraints are always included in a rehydration slice**, regardless of
   score or token-budget pressure. A dropped constraint is how an agent redoes the approach a human
   already rejected.

## Vendor neutrality

Nothing in `core` may assume a specific agent client. If it only works inside Claude Code, it is a
session feature rather than a handoff. Client differences get normalised at the edges.

## Reporting a security issue

Do not open a public issue. Use GitHub's private vulnerability reporting on this repository.

## Licence

By contributing you agree your contribution is licensed under Apache 2.0, as in [LICENSE](./LICENSE).
