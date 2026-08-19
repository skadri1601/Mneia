---
'@mneia/cli': patch
---

`mneia init` now detects hand edits inside the generated section instead of silently overwriting them. The begin marker carries a digest of the body Mneia wrote — `<!-- mneia:begin sha=… -->` — and a mismatch stops the run before anything is written, naming what to move out of the fence or offering `--force`. Sections written by earlier versions carry no digest and are accepted unchanged, then stamped on the next write.
