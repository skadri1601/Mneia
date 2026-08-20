---
'@mneia/mcp-server': patch
---

Fix the MCP server refusing to start. `mneia_retire` was linked into the tool list but never added to the registrable-tool allow-list, so the registry rejected it and took the whole server down with it — every tool, not just `mneia_retire`, was unreachable in 0.7.0.
