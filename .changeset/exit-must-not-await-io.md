---
'@mneia/mcp-server': patch
---

The orphaned-server exit no longer waits on I/O that cannot complete.

0.21.0 added an exit path for orphaned servers and it did not work. Thirteen servers running it were
found spinning four minutes after a reboot, 2,928 CPU-seconds between them. A CPU profile of a live
one showed why: the exit path had run — `record` from lifecycle.ts was 15% of the burn — but
`shutdown()` never resolved, because draining flushes telemetry and closes a store over the very
transport that just died. The exit was gated behind I/O that could not complete, so it never happened,
while the fault loop underneath kept running at full speed.

Three changes, all the same principle. The drain now gets a bounded window and the process leaves
regardless. The fault path does nothing at all once the process is already ending, because every line
it logged was a write inside the loop it was escaping. And a fault arriving while stdin is already
destroyed exits immediately rather than waiting twenty more faults to prove there is nobody to serve.
