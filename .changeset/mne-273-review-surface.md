---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

Let a person drain the review queue without opening a browser.

Items a checkpoint recorded wait for a human to confirm, edit, or reject them, and until now that
could only happen in the web app — an agent that had just run a checkpoint had no way to put the
queue in front of its human. `mneia review` lists what is waiting and `mneia review --drain` walks it
one item at a time, where confirm is one keypress and editing prefills rather than making you retype.
`mneia_review_queue` exposes the same queue to an agent, deliberately read-only: an MCP tool cannot
block and ask, so confirming there would be an agent deciding on a person's behalf.

A confirmation can only come from a keypress. `--drain` refuses off a TTY — piped, redirected, or in
CI — before it even reads the queue, and there is no flag anywhere that confirms an item.

Both surfaces go through one hosted handler, so the terminal and the web app return the same pending
set and leave the same record.
