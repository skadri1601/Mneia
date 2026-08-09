---
'@mneia/core': patch
'@mneia/cli': patch
'@mneia/mcp-server': patch
---

MNE-271: report the version the package actually is.

`VERSION` was a hand-maintained constant in `packages/core/src/index.ts` that changesets never
touched, so `0.2.0` shipped reporting itself as `0.1.1` through `mneia --version`,
`mneia-mcp --version`, the MCP `serverInfo`, and the API user-agent. `pnpm version:packages` now
syncs it, and `pnpm check:version` fails CI and the release preflight if the two ever disagree.
