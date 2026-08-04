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

> **Ruled 2026-07-29 (MNE-168), revised twice.** The first ruling chose a synthesis (dark canvas, amber
> accent); the second inverted Apple to black. **Both are superseded.** As of 2026-07-31 the design is
> Apple's, on Apple's own light canvas, with two single-token deviations. No blending, no inversion.

| File | Status |
|---|---|
| **`docs/design/apple.md`** | **The specification. Read it in full before writing UI.** Colours, typography ladder, spacing, radii, components, do/don'ts and breakpoints apply verbatim. |
| **`docs/design/mneia.md`** | **Read second, and it is short.** Records the two deviations and nothing else. |
| `docs/design/bmw-m.md` | Dead. Kept only so the MNE-168 reasoning stays legible. |

These are token specs, not mood boards, and they carry do/don't rules that are easy to violate by
accident. **If you find yourself picking a colour, you have gone wrong** — check `apple.md` first,
because it almost certainly already has one.

> **Type sizes are the one exception, ruled 2026-08-03 (MNE-238).** **Never take a font size from
> `apple.md`, or from this file's earlier ladder.** Apple's sizes are built for a landing page: 21px
> body, 46px display. Applied to `apps/web` they produced a heading filling a third of the viewport
> and the founder's verdict was *"not professional at all"*. Everything else in `apple.md` still
> applies verbatim — colours, spacing, radii, the one shadow, press states, touch targets.
>
> **The scale is compact, and it lives in the two `tokens.css` files, not here:** body 15px,
> secondary 13px, page heading 24px, section heading 18px. `apps/site` keeps a larger hero because a
> landing page needs one; its ratios were preserved and only the anchor moved.

The two deviations, both one token:

- **Type is scaled by `--type-scale`, currently 1.** Every size is `calc(Npx * var(--type-scale))`, so
  **every ratio in the ladder is preserved exactly**. To retune globally, change the multiplier —
  never an individual size, which re-ramps the ladder.
- **The artifact is set in JetBrains Mono.** `apple.md` defines no monospace face because Apple ships
  no code content.

Three things that trip people up:

- **Which blue, where.** Action Blue `#0066cc` on light surfaces and on every filled pill; Sky Link
  Blue `#2997ff` for inline links **on dark tiles only**, because Action Blue disappears there. That
  pair is Apple's own — **not** licence for a second accent.
- **Text follows its tile.** Each `Tile` sets `--tile-ink`, `--tile-muted`, `--tile-faint`,
  `--tile-link`, `--tile-hairline`, `--tile-card`. Components read those. **A component that hardcodes
  a text colour is wrong inside half the tiles**, because Apple's sections alternate light and dark.
- **We have no product photography.** The handoff artifact panel takes the product render's structural
  position: it rests on a **light** tile and is the **sole** carrier of the system's one drop-shadow.
  On a dark tile it vanishes and takes the shadow with it. Nothing else gets a shadow, ever.

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

- **Tokens, never inline hex.** The specs use `{token.refs}` throughout. Match it — a hardcoded
  `#0066cc` is a bug even when the value is right. `apps/site` enforces this: every value lives in
  `tokens.css` and a literal hex anywhere else fails review.
- **One accent colour.** Action Blue `#0066cc` on light surfaces and every filled pill; Sky Link Blue
  `#2997ff` for inline links **on dark tiles only**. One accent at two lightnesses, per `apple.md`.
  No third blue, and no second accent.
- **Type sizes are `calc(Npx * var(--type-scale))`.** Never a bare px size — that re-ramps the ladder.
- **One shadow in the system**, on the handoff artifact panel. Never on cards, buttons, nav, or text.
- **Surface-colour change is the section divider.** No borders between sections, no gradients anywhere.
- **Default and active/pressed states only.** Never document hover.
- **`transform: scale(0.95)` is the press state** on every button — Apple's system-wide micro-interaction.
- **Body copy at 15px** (MNE-238), and the weight ladder is 300 / 400 / 600 / 700 with 500 absent.
  Ignore any size `apple.md` states — that ladder is rejected for type and type only.
- **Minimum 44 × 44px touch targets.**
- **Variants are separate component entries** (`-active`, `-focus`, `-dark-2`), not conditional props
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
