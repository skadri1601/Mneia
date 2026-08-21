---
paths:
  - "packages/cli/**"
---

# CLI rules

Binary is `mneia`. Config lives in `.mneia/` in the repo.

## Command surface

| Milestone | Commands |
|---|---|
| M1 | `init`, `brief`, `checkpoint`, `log`, `status`, plus `login` and `whoami` |
| M2 | `handoff`, `pickup` — ~~`sync`~~ cancelled by §11.1, there is nothing to sync |
| M3 | `verify` |
| M4 | `team`, `sessions`, `conflicts` |

Do not build ahead of the milestone. §12.2 has the full intended surface.

`router.ts` holds `SHIPPED_COMMAND_NAMES` and is the truth; `assertRegistrableCommands`
throws on a command registered in `bin.ts` but missing there. Count the array rather than
trusting this table.

**`team` and `sessions` are M4 surface shipped early**, under MNE-135, because a directed
handoff is unusable without a way to name the recipient — §2.1 calls that the scenario the
product is named for. They are read-only: neither creates an actor nor sends an invitation.

## The interactive session is not another command

Bare `mneia` on a TTY opens a REPL (`session.ts`), dispatched from `bin.ts` before `route()`. It is
deliberately **not** registered as a command, so the M1 guard in `router.ts` keeps meaning what it
says — `assertRegistrableCommands` still rejects anything outside the surface above.

Two invariants, both tested:

- **Every line goes through `route()`.** The REPL parses a line into argv and hands it over. It must
  never call a command's `run` directly or reach the API itself, or the interactive and one-shot
  forms will drift and `--json`, `--help`, and error rendering will differ between them.
- **Off a TTY, nothing changed.** Piped, redirected, or in CI, bare `mneia` still prints the command
  list to stderr and exits `2`. The dogfood hooks and any script depending on that must keep working.

It dispatches commands; it does not talk to a model. A prompt that answers questions would be the
§19 chat interface, which is a non-goal — see the `scope-check` skill before extending it that way.

## Every command is an authenticated API call

**Hosted-only** (§11.1, resolved 2026-07-28). There is no local store, no `sync`, and no offline
mode. `mneia login` runs a device flow and writes a token to `~/.mneia/credentials`; CI authenticates
with `MNEIA_TOKEN` instead.

`.mneia/config` in the repo holds the project binding — workspace, project slug, endpoint. **No data
and no credentials.** Credentials never enter the repo.

Two consequences worth holding onto:

- **Network failure is a first-class state, not an edge case.** Every command can fail because the
  API is unreachable. Say so plainly and distinguish it from an auth failure or a real error — a
  developer whose wifi dropped should not be told their token is invalid.
- **§12.1's 300ms p95 is now a network budget**, not a disk budget. Whether that holds without a read
  cache is measured, not assumed — §11.2 item 2.

## `checkpoint` is where the moat is collected

This is the **primary human-confirmation surface**, because unlike an MCP tool the CLI can actually
block and ask. Most of the M1/M2 arbitration dataset comes through here (§17, §8.1 rule 2).

So the interaction quality has outsized strategic weight:

- Confirm is **one keypress**
- Edit does **not** require retyping the whole item
- Prompt only for what genuinely needs a human — load-bearing or contradicting items

A clumsy prompt does not merely annoy. Users who dread the review checkpoint less, which takes the
dataset with it.

## Output

Human-readable by default; `--json` on anything an agent or script might consume. Never colour-only —
carry meaning in the text so piped output stays intelligible.

Errors name the fix, not just the failure. `mneia brief` with no project should say `run mneia init`.

## Do not clobber user files

Write-back into `AGENTS.md` / `CLAUDE.md` stays inside a clearly fenced generated section, always.
It is their file, in their repo, in their git history — clobbering it is an unrecoverable trust
failure, and MNE-99 treats the fence boundary as a tested invariant rather than a convention.
