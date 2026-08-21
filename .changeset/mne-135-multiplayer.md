---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

Make a second person possible on a shared repo.

A handoff can now be addressed to a teammate by name, and lands in their inbox. `mneia team` lists
the workspace roster so a recipient can be named at all — `--to` previously demanded a raw actor
uuid nobody could look up. `mneia pickup` separates "addressed to you" from "open — anyone may pick
it up", instead of showing every unreceived handoff in the project. The same four capabilities ship
as MCP tools — `mneia_team`, `mneia_sessions`, `mneia_handoff_inbox` — and `mneia_handoff_create`
accepts a name or an email for `toActor`.

`mneia sessions` reads back what the session table has always recorded and nothing ever showed: who
worked on this project, from which client, over what window, and how many checkpoints and context
items came out of it.

`mneia checkpoint` is no longer limited to the single newest agent session. It still defaults to
that session, but now reports how many others it did not read; `--session <ref>` picks one and
`--all-sessions` walks them, reporting a per-session outcome rather than stopping at the first
failure.

Session discovery was rebuilt to survive real data. Listing sessions read and fully parsed every
transcript under the agent's project directory — 896 files and 631 MB on one developer machine —
which was tolerable only because nothing ever asked for more than one. It now pre-filters by project
directory and reads bounded windows. Codex sessions are also deduplicated: resuming or forking a
session writes a new rollout file carrying the same id, and one session appeared in 33 of them.
Cursor conversations with no workspace mapping are now reported rather than silently discarded.
