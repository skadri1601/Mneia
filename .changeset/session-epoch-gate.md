---
'@mneia/cli': patch
---

Never checkpoint a session that started before the repo was bound to Mneia. `mneia init` now
records `boundAt` in `.mneia/config.json`, and `mneia checkpoint` skips anything older — context
from before the install is out of scope, and sweeping it back in paid a model to read transcripts
that predate the product.
