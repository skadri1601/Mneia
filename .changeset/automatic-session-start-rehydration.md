---
'@mneia/cli': minor
---

Project memory now loads itself at session start. `mneia init` installs a session-start hook for
Claude Code, Codex and Cursor, so an agent opening the repo is handed the active constraints and
decisions before it plans anything — with nothing to type and nothing to remember.

The hook is one new command, `mneia hook session-start --client <harness>`, which reads the payload
the harness writes to its stdin and answers with that harness's envelope. It never fails the session:
an unreachable API, an unbound repo, or a slice that takes longer than 12 seconds all produce an
explicit "memory not loaded, do not assume the recorded constraints are in front of you" note rather
than silence, because an agent cannot tell an empty project from an unreachable one.

Existing files are merged, never replaced — `.claude/settings.json` in particular also carries
permissions and environment. Re-running `mneia init` updates the entry in place rather than adding a
second one. Pass `--no-hooks` to skip it.
