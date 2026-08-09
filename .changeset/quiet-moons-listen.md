---
'@mneia/cli': patch
'@mneia/mcp-server': patch
---

MNE-260: `MNEIA_HOME` moves the credentials and the local binding off `~/.mneia`.

The CLI resolved the credentials file and the local binding straight from the operating system
home directory, and the commands never passed their own environment into that resolution — so
`mneia status` on a machine that had ever run the bootstrap script behaved differently from one
that had not, and the test suite mutated a real user directory. Both surfaces now read
`MNEIA_HOME`, so a login and the MCP server that consumes it stay pointed at the same place.
