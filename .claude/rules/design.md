---
paths:
  - "apps/web/**"
  - "apps/site/**"
  - "**/*.tsx"
  - "**/*.css"
  - "**/tailwind.config.*"
---

# Design rules

## The governing spec

> **Ruled 2026-07-29 (MNE-168).** This section previously said the language was undecided and told you
> to ask before building UI. **It is decided.** `docs/design/mneia.md` is the design language.

| File | Status |
|---|---|
| **`docs/design/mneia.md`** | **The governing spec. Read it in full before writing UI.** Near-black canvas, single amber accent, exactly one drop-shadow — on the handoff artifact. Apple's restraint rules on a dark canvas. |
| `docs/design/apple.md` | Reference only. Where the restraint rules come from, and the source of the Inter substitution guidance. **Do not build against it.** |
| `docs/design/bmw-m.md` | Reference only. Where the dark canvas comes from. **Do not build against it.** |

These are token specs, not mood boards, and they carry do/don't rules that are easy to violate by
accident. The two references remain in the repo because `mneia.md` cites them and because the reasoning
behind the ruling is worth keeping legible — not because either is still a live option.

**The structural inversion worth knowing before you start:** Apple's system is built around product
photography, which we do not have and cannot produce. In `mneia.md` the **handoff artifact** takes that
role. It is the only element carrying the system's one shadow, and it is what the tiles exist to frame.
If you are building a surface with no artifact on it, you are building the quiet part of the system —
keep it quiet.

## When this matters

> **Rewritten 2026-07-29.** This section previously said *"nothing in M0, M1, or M2 renders a pixel"* and
> *"file it, do not build it."* The founder ruling that moved the web app and billing into M1 (§12.3) makes
> both false. **M1 renders pixels.** If you are building M1 and reached this file expecting permission to
> defer design decisions, you do not have it.

M0 renders nothing — **except that it now does.** MNE-184 built the marketing site during M0 on founder
direction, ahead of MNE-120's M3 slot. The surfaces that consume the spec:

- **MNE-184** — marketing site: home, features, pricing, about, handoff (**built, M0, out of order**)
- **MNE-181** — web account plane: signup, device-flow approval, workspace and project management (**M1**)
- **MNE-25** — web review app: decision browser, review queue, timeline (**M1**)
- **MNE-120** — docs site; the landing-page half was absorbed by MNE-184 (M3)
- **MNE-133** — conflict resolution UI (M4, with the conflict engine it renders)

**`apps/site` is now the reference implementation of the spec.** It set the defaults, which is exactly
what this section warned the first screen would do. When you build MNE-181, read `apps/site/src/styles/
tokens.css` and the components beside it before inventing anything — divergence there is drift, not
iteration.

## Rules that hold regardless of surface

- **Tokens, never inline hex.** The spec uses `{token.refs}` throughout. Match it — a hardcoded
  `#ffb340` is a bug even when the value is right. `apps/site` enforces this: every value lives in
  `tokens.css` and a literal hex anywhere else fails review.
- **One accent colour.** Amber, and nothing else. The `human`/`agent` provenance pair is the accent
  reused plus a muted grey, not a second signal colour.
- **One shadow in the system**, on the handoff artifact panel. Never on cards, buttons, nav, or text.
- **Surface-colour change is the section divider.** No borders between sections, no gradients anywhere.
- **Default and active/pressed states only.** Never document hover.
- **Minimum 44 × 44px touch targets.**
- **Variants are separate component entries** (`-press`, `-focus`, `-featured`), not conditional props
  buried in one component.

## The web app stays thin

§4 calls it a thin web app, and §19 rules out a chat interface or an agent of our own. **Thin is the
specification, not a hedge.**

The developer inner loop stays in the terminal and the editor. The web app exists only for what a CLI
is genuinely bad at: reviewing a queue, comparing two conflicting items side by side, and browsing a
decision timeline — plus the account plane, which exists because hosted-only requires somewhere to sign
up and approve a device code, not because anyone should want to visit it.

**Shipping web in M1 makes this rule harder to hold, not softer.** The web app arriving at the same time
as the CLI invites treating it as the primary surface. It is not. If a feature could live in the MCP
server or the CLI, it goes there — §12.3's tripwire still applies: a surface that needs a fifth verb is
becoming its own product.

If a feature would pull daily work out of the CLI and into the browser, that is a scope question —
run the `scope-check` skill.

## Positioning constraint

§16: the launch leads with **compaction pain and the handoff artifact**, not "AI memory." Whatever
the design language, the landing page's job is to make a developer recognise their own Tuesday
morning (§2.1) and then show them a real handoff.

The strongest asset on that page is the artifact itself. No competitor's site can show one.
