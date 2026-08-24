---
'@mneia/cli': minor
---

`mneia checkpoint` with no flags now checkpoints the single most recently active harness session,
and `--all-sessions` opts into the sweep it used to do by default.

The 24-hour activity window was not enough on its own. Discovery is a filesystem scan of every
installed harness — Claude Code, Claude Desktop, Codex, Cursor, Gemini, Warp — keyed on the working
directory, so on a repo worked in across several terminals twenty transcripts sit inside that window
and a bare `mneia checkpoint` bought a paid extraction for each of them. Someone typing the command
means the session they are typing in.

Nothing is hidden by reading one: the command names on stderr how many other sessions it discovered
and did not read, and the flags that reach them. Each session keeps its own watermark, so one
checkpointed later resumes from where it was rather than starting over.

`--session <ref>` is unchanged, and still ignores the activity window.
