---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

MNE-86: record which client and which conversation a context item came from.

`session` gains five nullable columns — `client_name`, `client_version`, `client_session_ref`,
`client_session_name`, `client_session_url` — populated from the MCP initialization handshake and
the harness conversation metadata, and surfaced on context reads as store-derived provenance.

Client identity is taken only from the handshake, never from a tool payload, so `asserted_by` and
`human_confirmed` keep their §10 authority. A write whose client metadata is missing is preserved
and flagged partial rather than discarded, and reads that cannot resolve provenance report it as
incomplete instead of fabricating it. Sessions are created lazily per conversation, so
`mneia_rehydrate` gains no round trip against the §12.1 300ms budget.
