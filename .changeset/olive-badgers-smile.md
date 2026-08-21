---
'@mneia/core': minor
'@mneia/cli': minor
'@mneia/mcp-server': minor
---

`mneia checkpoint` now reads every agent session discovered for the directory, not only the most recent one. A session you never checkpointed no longer stays invisible. `--all-sessions` still works and now names the default; `--session <ref>` still picks one.

Sweeping is affordable because `propose` asks for the watermark before it uploads anything — a session with no new turns sends no transcript at all, where it previously re-uploaded the whole thing to discover there was nothing to do.

Fixed: the API rejected an upload of no turns, so a session too large for a single request could not be checkpointed at all. The incremental-upload path had been sending exactly that as its first request.

Rehydration got roughly three times faster on a large corpus. The candidate query no longer serialises every candidate's embedding vector to text before discarding all but the top 200; the cosine similarity the ranker needs is computed once in Postgres and returned as a number. Measured on 8,000 items, p95 fell from 331ms to 107ms, back inside the 300ms budget.

Gemini CLI sessions are now a capture source. `mneia checkpoint` discovers them for the directory you are in, attributing each one through the project map Gemini CLI keeps. Sessions written by an older Gemini CLI, which named its project directory by a hash rather than by the path, are readable by naming them with `--session <ref>` — they carry no directory of their own, so nothing guesses one for them.
