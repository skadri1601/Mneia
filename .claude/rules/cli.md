---
paths:
  - "packages/cli/**"
---

# CLI rules

Binary is `mneia`. Config lives in `.mneia/` in the repo.

## Command surface

| Milestone | Commands |
|---|---|
| M1 | `init`, `brief`, `checkpoint`, `log`, `status` |
| M2 | `handoff`, `pickup`, `sync` |
| M4 | `conflicts` |

Do not build ahead of the milestone. §12.2 has the full intended surface.

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
