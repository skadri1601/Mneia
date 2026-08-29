---
'@mneia/mcp-server': minor
---

The MCP server now exits when its client is gone, instead of pegging a CPU core forever.

Four orphaned servers were found on one laptop burning 33.9 CPU-hours between them, each holding a
core at 100% for hours. The only symptom anyone noticed was the fan.

Two decisions combined into it. `uncaughtException` logged "session continues" and returned, so a
read that fails permanently was retried as fast as the event loop allowed; and the transport close
path drained without ever exiting, so nothing ended the process. Neither is wrong alone.

`npx` is what turns that into an orphan. On Windows it inserts `node npx-cli.js` and `cmd.exe`
between the client and the server, and those intermediates keep the stdin handle open after the
client dies — so the clean end-of-stream that would have exited the server never arrives.

Now four routes end a session and all of them exit: a signal, stdin ending, stdin erroring, and
faults arriving faster than a working server ever produces them. That last one is a budget rather
than a switch, so an isolated bad tool call still leaves the server serving.
