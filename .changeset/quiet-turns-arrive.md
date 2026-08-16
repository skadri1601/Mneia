---
'@mneia/cli': patch
---

`mneia checkpoint` now uploads the whole session transcript instead of capping it at 700,000
characters first. Sessions above that cap previously had turns dropped on the client, and because
the server sets the watermark from what it received, those turns were skipped permanently — running
the command again did not pick them up.

The server has chunked oversized transcripts since 0.2.0, so the client cap was discarding work the
API could already accept. Per-turn truncation of large tool output and secret redaction are
unchanged; only the whole-transcript drop is gone.
