---
'@mneia/cli': minor
---

`mneia checkpoint` with no `--session` now checkpoints only the harness sessions active in the
last 24 hours, instead of every transcript ever written for the directory.

Session discovery is a filesystem scan of every installed harness — Claude Code, Claude Desktop,
Codex, Cursor, Gemini, Warp — keyed on the working directory and nothing else. It cannot tell
which of them is running, so an unnamed sweep bought an extraction for twenty unrelated sessions,
including harnesses the user had not opened in weeks, and printed nothing until all of them
finished.

`--session <ref>` ignores the window, and `--all-sessions` reaches past it for the backfill case.
When every discovered session is idle the command now names the flag rather than sweeping.
