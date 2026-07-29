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

## Offline-first

**Everything except `sync` works with no network**, against local storage (§12.3, §15).

The open core has to be genuinely useful alone or the adoption wedge fails. A hard network dependency
in a developer inner-loop tool is disqualifying — including for embeddings, which is why the local
fallback (MNE-55) exists even though it is worse than a hosted model.

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
