# Handoff: lane A — 2026-08-19

From: Claude session A (agent) · 2026-08-19 UTC
To: open

Written in the §10.3 format, because that is the format this session built. **Every line below is
marked verified or unverified.** The unverified ones are proposals from a conversation that did not
conclude — do not read them as decisions.

## Next action

**Rule on MNE-96 — what `handoff.time_to_first_action` measures.** Nothing else in lane A is
blocked. Do this with the ticket open and `packages/core/src/telemetry/types.ts:117` in front of you,
not from this document.

## State

- **`main` is at `1b90804`.** Schema version **31**, next free migration `0032`.
- **The MNE-14 handoff epic is built end to end.** Renderer, assembly, three API routes plus
  `/items`, `mneia handoff` / `mneia pickup`, `mneia_handoff_create` / `mneia_handoff_receive`, and
  `/handoff/[id]`. Seven PRs merged today: #135, #136, #139, #140, #141, #144.
- **`Done` today:** MNE-89, 90, 91, 92, 93, 94, 95, plus fourteen stale M1 tickets closed in
  reconciliation and MNE-274 closed by the founder.
- **Open in lane A: MNE-96 and MNE-97 only.**
- Lane B is live on the same `main` — MNE-79, MNE-100, MNE-103, MNE-240 landed today. Rebase before
  branching.
- **Nothing is deployed by this session.** #144 merged; whether production has it is unchecked.
  `curl -s https://app.mneia.dev/api/health` before assuming.

## Constraints (do not violate)

- [human · founder · confirmed 2026-08-19] **Cost we can absorb, data loss we cannot.** Ruled on the
  watermark question. Any fix keeps re-reading rather than refusing an upload.
- [human · founder · confirmed 2026-08-19] **Do not gate an event on its pair arriving.** If one arm
  of a measurement is missed, withholding the other destroys both, and §17 is not backfillable.
- [human · founder · confirmed 2026-08-17] **No temporal framing in published docs.** No "coming
  soon", no milestone labels — that reads as a drawback rather than as honesty.
- [agent · claude-code · human-confirmed 2026-08-19] Standing rule 8: **MNE-97's spec stays
  internal** until we own the reference implementation *and* the early adopters. We own the first.
- [agent · claude-code · unconfirmed] **Do not add a §17 event name.** MNE-51's coverage test is what
  makes standing rule 5 real; widening the name set weakens it.

## Decisions and why

- [2026-08-19 · human] **MNE-274 closed.** Fixed in `9c75675` on the 8th; the board was stale.
- [2026-08-19 · agent, human-confirmed] **The watermark defect is a ruling, not a patch.**
  `propose.test.ts:142` deliberately pins re-read-everything as losslessness over cost.
- [2026-08-19 · agent] **MNE-96 left unbuilt rather than approximated.** Emitting create-to-receive
  under a name meaning "first action" would put a number in the arbitration dataset that does not
  mean what the name says.
- [2026-08-19 · agent] **The §17 coverage scan was widened** to see a bare `assembleHandoff(` call,
  and given one file-scoped exemption for the MCP tool — the hosted API already emits
  `handoff.received`, so emitting client-side too would double-count.

## Open questions

- [ ] **MNE-96 — what is "first action"?** Unresolved. My suggestion was the receiver's first §17
  write on that project after receipt, with a cold-start control arm, `handoffId` widened to
  `Uuid | null` so both arms always emit. **The founder ended the session calling the reasoning
  unreliable. Treat that whole design as unverified and re-derive it.**
- [ ] **The watermark ordinal.** Founder said circle back. Making the watermark monotonic needs a
  turn ordinal stored beside the ref, because the server cannot compare a ref that is absent from the
  upload — migration `0032`, which serialises both lanes.
- [ ] **MNE-97's shape.** A spec plus a test asserting `renderHandoff` still matches its example.
  Unverified as the right approach.

## Superseded recently (do not re-propose)

- ~~"Refuse the upload when the watermark is missing"~~ superseded 2026-08-19 — the founder ruled
  cost is absorbable and data loss is not.
- ~~"Emit `time_to_first_action` only when both arms exist"~~ superseded 2026-08-19 — a missed arm
  would silently destroy the other.
- ~~"M1 has 24 tickets left"~~ superseded 2026-08-19 — fourteen were merged and never closed.

## Artifacts

- `docs/WORKSTREAMS.md` — the lane split, and §7 for findings neither lane owns
- PRs #135, #136, #139, #140, #141, #144
- `packages/core/src/handoff/` — `render.ts`, `assemble.ts`
- `packages/core/src/telemetry/types.ts:117` — the event MNE-96 has to fill
- `packages/core/src/telemetry/coverage.test.ts` — `EXEMPT_CALLS`, read before adding a second entry

## Two findings neither lane has been told to fix

- MNE-51's scan reads `packages/cli/src/commands` only, so the CLI's `.receiveHandoff(` call in
  `http-api.ts` is **outside it**. It passes by file placement, not by correctness.
- Nothing tests the published doc samples against the real renderers. #141 fixed one drift by hand;
  the class of bug is still open.
