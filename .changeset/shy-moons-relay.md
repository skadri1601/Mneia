---
'@mneia/mcp-server': minor
---

Add `mneia_review_confirm`, so an agent can relay a human decision on a queued item through the
approval UI its client already has — Claude Code's ask, Cursor's inline approval, or a plain
question — instead of leaving the queue drainable only from a terminal. It records one decision at
a time: `approve` marks the item human-confirmed, `reject` retires it with the reason the person
gave. The reviewing actor is read from the token and its kind from the database, never from the
arguments, so a server authenticated as an agent is refused (vision.md §10.1). `mneia review
--drain` is unchanged.
