# Skills

Multi-step procedures that load **on demand** rather than into every session. Claude Code matches the
`description` in each skill's frontmatter against the prompt, so descriptions here are written to be
specific and trigger reliably.

Live in `.claude/skills/<name>/SKILL.md`. Other agents can read them directly as markdown.

## Available

| Skill | Invoke when | Why it is a skill |
|---|---|---|
| **`linear-ticket`** | Starting or finishing any unit of work | Six-step procedure with easy-to-skip steps — the *Done when* verification and the status transitions |
| **`scope-check`** | A request may touch a `vision.md` §19 non-goal | Needs a written ruling logged under MNE-164, not a judgement call in the moment |
| **`milestone-gate`** | A milestone is ending, or a `GATE:` ticket needs running | Four-part ritual from `ROADMAP.md` §4, and it must be able to fail |
| **`db-migration`** | Adding or changing a table, column, or index | Both engines, seed harness, round-trip, parity, telemetry — in one PR |

## Why these are skills and not rules

`.claude/rules/` holds facts that are true whenever you touch matching files. Skills hold
**procedures with steps that get skipped under time pressure** — and the skipped step is usually the
one that mattered.

That split is deliberate, and it is the same argument the product makes. Loading every procedure into
every session is how you get context rot (`vision.md` §2), which is the problem Mneia exists to fix.
A repo for a context-engineering company that ships a 2,000-line always-loaded instruction file would
not be a good look.

## What loads when

| | Loads | Lines |
|---|---|---|
| `CLAUDE.md` + `AGENTS.md` | Every session | 168 |
| `.claude/rules/00-index.md` | Every session | 32 |
| Other `.claude/rules/*.md` | When you touch matching paths | 381, none until relevant |
| `.claude/skills/*/SKILL.md` | When invoked or matched | 227, none until needed |
| `vision.md`, `ROADMAP.md`, `docs/STACK.md` | Read on demand | 0 until read |

**200 lines at launch, 608 available.** Anthropic's documented target for always-loaded instructions
is under 200 lines, so there is no headroom left. Anything new goes into a path-scoped rule or a
skill — never into `AGENTS.md`.

## Adding one

1. `.claude/skills/<name>/SKILL.md` with `name` and `description` frontmatter
2. Write the `description` for **matching**, not for humans — name the concrete triggers, e.g.
   *"when the user runs the test suite and it fails"* rather than *"testing help"*
3. Body under ~500 tokens; link to reference files for anything longer
4. Add a row to the table above
5. Reference it from `CLAUDE.md` if it should be top-of-mind every session
