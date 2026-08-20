---
'@mneia/mcp-server': patch
'@mneia/cli': patch
---

Correct the published READMEs, which advertised a surface three releases out of date. The MCP server
README announced four tools and listed four; it ships seven — `mneia_retire`, `mneia_handoff_create`
and `mneia_handoff_receive` were missing. The CLI README said `handoff` and `pickup` were "named but
not yet shipped", omitted both from the command table, and described the interactive session as
carrying seven commands rather than nine.
