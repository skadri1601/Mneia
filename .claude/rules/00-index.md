# Rules index

<!-- No `paths` frontmatter, so this loads every session. Keep it a map, never content.
     Every other rule in this directory is path-scoped and loads only on matching files. -->

Detail lives here so `CLAUDE.md` and `AGENTS.md` stay small. Each rule below declares the paths that
trigger it — you will not see most of them until you touch the relevant code.

| Rule | Loads when you touch | Covers |
|---|---|---|
| `architecture.md` | `packages/**` | Package boundaries, the open/closed split, dependency direction |
| `data-model.md` | schema, migrations, store | The §9 tables, bi-temporality, engine parity |
| `telemetry.md` | `**/telemetry/**`, events | The §17 event spine and its coverage test |
| `testing.md` | `**/*.test.ts`, `**/*.spec.ts` | Vitest conventions, the two GUARD invariants |
| `typescript-style.md` | `**/*.ts`, `**/*.tsx` | Strictness, error handling, no-comments rule |
| `mcp-server.md` | `packages/mcp-server/**` | Tool naming, the 300ms budget, client neutrality |
| `cli.md` | `packages/cli/**` | Command surface, output conventions, offline-first |
| `design.md` | `apps/**`, `*.tsx`, `*.css` | Design token specs, the thin-web-app rule, positioning |

## Reference, read on demand

Not rules — background you fetch when a decision needs it.

- `vision.md` — the founding brief. Cited as §n everywhere.
- `ROADMAP.md` — milestones, checklist, Linear workflow, milestone-boundary ritual
- `docs/STACK.md` — tooling choices, and the three still open
- `docs/design/apple.md`, `docs/design/bmw-m.md` — full design token specs, read before any UI work
- `SKILLS.md` — skill index

## If a rule and a ticket disagree

The nine standing rules in `AGENTS.md` win — they come from `vision.md` and outrank any ticket.
For anything else, the ticket is more specific and probably more current. Say which you followed
and why in the PR, so the loser gets fixed rather than silently ignored.
