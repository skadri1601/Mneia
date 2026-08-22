---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

`mneia checkpoint --session <ref>` accepts `--source <harness>` alongside it. When both are given, Mneia reads that one transcript directly instead of enumerating every harness on the machine and filtering the results down.

Discovery was scan-then-filter: every invocation opened Cursor's global `state.vscdb` and one per Cursor workspace, walked `~/.gemini`, and parsed every Codex, Claude Desktop and Warp session it could find, only to discard everything whose working directory was not the one you ran in. That cost about 1.3s and a great deal of I/O before any useful work, and sessions that record no working directory showed up as `blocked` noise from folders you were not working in.

An automatic trigger already knows which harness it is, which session just ended, and which directory it ran in. It can now say so.

`createReaders(sources)` in `@mneia/core` takes an optional source list and builds only those readers.
