---
"@mneia/core": minor
"@mneia/cli": minor
"@mneia/mcp-server": minor
---

Stop paying twice for the same turns when a transcript rotates.

`propose` ignored the `resolved` flag from `turnsSince`, so an upload that did not reach
back to the stored watermark was treated as entirely new: the watermark moved backwards and
every turn in between was extracted, and billed, a second time.

Telling the two cases apart needs the client, because the server cannot distinguish "turns
went missing between us" from "this transcript no longer goes back that far" by looking at
the upload alone. `CheckpointProposeWireSchema` therefore gains `fromStart`, which the CLI
sets only after probing for the watermark and finding the transcript has rotated past it.
It defaults to `false`, so an older client is unaffected.

The same schema also drops `.min(1)` from `turns`. The client probes for the watermark by
uploading no turns, and requiring at least one made an oversized session impossible to
checkpoint at all (MNE-100).
