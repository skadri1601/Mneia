---
'@mneia/cli': minor
---

Project memory now loads itself at session start. `mneia init` installs a session-start hook for
Claude Code, Codex and Cursor, so an agent opening the repo is handed the active constraints and
decisions before it plans anything — with nothing to type and nothing to remember.

The hook is one new command, `mneia hook session-start --client <harness>`, which reads the payload
the harness writes to its stdin and answers with that harness's envelope. It never fails the session:
an unreachable API, an unbound repo, or a slice that takes longer than 8 seconds all produce an
explicit "memory not loaded, do not assume the recorded constraints are in front of you" note rather
than silence, because an agent cannot tell an empty project from an unreachable one. That 8 second
deadline sits below the 12 seconds the harness is told to wait, so there is always time left to
write the note.

`npx @mneia/cli init` is supported without installing anything: the hook it persists is pinned to
the version that ran it, so it stays runnable once the npx process is gone. `mneia init` reports
which form it wrote.

The generated AGENTS.md section is rendered from what was actually installed. With `--no-hooks`, or
when an install fails, it keeps the instruction to run `mneia brief "<task>"` by hand rather than
telling the next agent there is nothing to run.

Existing files are merged, never replaced — `.claude/settings.json` in particular also carries
permissions and environment. Re-running `mneia init` updates the entry in place rather than adding a
second one. Pass `--no-hooks` to skip it.
