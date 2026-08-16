---
'@mneia/cli': patch
---

`mneia checkpoint` no longer discards turns from a large session before uploading it. Previously the
client reduced the transcript to 700,000 characters and sent only what survived; because the server
sets its watermark from what it received, the discarded turns were marked as covered and running the
command again did not pick them up.

A session too large for one request is now uploaded across successive runs instead. The turns that do
not fit are reported as pending — the state that already means "run again, nothing was skipped" —
rather than dropped. Per-turn truncation of large tool output and secret redaction are unchanged.
