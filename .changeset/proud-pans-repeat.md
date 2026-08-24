---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

Checkpoint sub-agent sessions, and link them to the session that spawned them.

The Claude Code reader now descends into `subagents/` directories, which a flat `readdir` never
saw — 28% of transcripts on the machine this was measured against. A sub-agent session takes its
ref from its filename rather than from the parent's `sessionId` recorded inside it, so parent and
child stay distinct, and it reports the parent's ref as `parentSessionRef`.

`session.parent_session_id` records that link. Callers name the parent by its client session ref
(`parentClientSessionRef` on session creation, `sourceSession.parentRef` on an MCP write) and the
store resolves it within the workspace.

`mneia checkpoint` gives sub-agents their own budget rather than letting them compete with root
sessions for `MAX_CHECKPOINT_SESSIONS` — they share their parent's working directory, so one busy
fan-out could previously take every slot and leave the other sessions of the day uncovered.
