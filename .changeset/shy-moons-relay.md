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

The decision emits its §17 arbitration event — `checkpoint.item_confirmed` or
`checkpoint.item_rejected` — from the tool itself, so a confirmation relayed through the hosted
`/api/mcp` endpoint, which serves a direct scoped store rather than the REST wrapper that emits,
is recorded rather than lost. A transport failure now reports the outcome as unknown and points
the caller back at `mneia_review_queue`, instead of claiming nothing was written when the review
may already have committed.
