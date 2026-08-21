---
'@mneia/cli': minor
---

Read a handoff without receiving it: `mneia pickup <id> --read`.

Until now the only way to see a handoff body from the terminal was `mneia pickup <id>`, which
consumes it — stamps `received_at`, emits `handoff.received`, and drops it off everyone else's
inbox. So the ordinary case, deciding whether a piece of work is yours before claiming it, could
only be done by claiming it first.

`--read` renders the same artifact and changes nothing. It ends with the command that does claim it,
so the two acts stay distinct rather than one being a side effect of looking.
