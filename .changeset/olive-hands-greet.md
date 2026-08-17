---
'@mneia/cli': minor
---

MNE-12: `mneia` with no arguments opens an interactive session instead of exiting.

Bare `mneia` printed the command list to stderr and exited `2` — correct for a script, wrong for a
person. On a TTY it now opens a persistent session: a prompt that dispatches `/init`, `/brief`,
`/checkpoint`, `/log`, `/status`, `/login` and `/whoami` with their usual flags, completes slash
commands on Tab, keeps a history, and treats anything not starting with `/` as a task to rehydrate.
An absent or expired token runs the existing device flow inline rather than sending the user away
to another command.

Off a TTY — piped, redirected, or in CI — bare `mneia` is unchanged: command list to stderr, exit
`2`. One-shot `mneia <command>` is unchanged in every context.

The session is a shell over the existing commands. It reimplements none of them, adds no dependency,
and never reaches the API itself; every line goes through the same router as the one-shot form, so
the two cannot drift.
