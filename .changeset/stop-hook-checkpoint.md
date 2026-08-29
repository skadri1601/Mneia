---
'@mneia/cli': minor
---

`mneia init` now installs the end-of-turn checkpoint hook, not only session-start rehydration.

A repository set up before this read memory at the top of every session and never wrote any at the
end of one, so a fresh install rehydrated forever from a store nothing filled. Reading without
writing is not half a loop, it is a loop that drains.

`mneia hook stop --client <harness>` is the runtime. It checkpoints the session the harness names
rather than sweeping the directory, so one agent ending a turn does not extract every other agent's
transcript and bill for each. It refuses to run when `stop_hook_active` is set, which is the
difference between a hook and a billing loop, and it writes nothing to stdout because a Stop hook's
stdout is read back as a directive. Like session-start it always exits 0: a lost capture is better
than a broken session.

Installed for Claude Code, whose `Stop` event is verified. Codex and Cursor are left alone and named
in the output rather than given a guessed event name, because a hook that looks installed and never
fires is worse than none.

`mneia init` also now points at `mneia mcp install --all` for the tools an agent calls on purpose.
It does not run it, because that writes to client configs outside the repository.
