---
version: 3.0
name: Mneia-design-language
description: Apple's design language, implemented as written. docs/design/apple.md is the specification — palette, typography ladder, spacing, radii, components, and breakpoints all apply verbatim. This file records the two deviations, both of which are single-token changes.

deviations:
  type-scale: 1.15
  artifact-face: "JetBrains Mono"
---

## What this file is

**`docs/design/apple.md` is the specification.** Read it in full before writing UI. Its colours,
typography ladder, spacing scale, radius scale, component definitions, do/don't rules, and responsive
breakpoints apply **exactly as written**.

This file records the two places we deviate. There are only two, both are one token, and neither is
licence to diverge further.

> **History.** Version 1.0 was a synthesis — a dark canvas with an amber accent and Apple's rules
> applied selectively. Version 2.0 was Apple's system inverted to a black canvas. **Both are
> superseded.** The founder ruled on 2026-07-31 that the design is Apple's, on Apple's own light
> canvas. The amber accent, the bespoke type ramp, and the black inversion are all gone.

## Deviation 1: the type ladder is ours, not Apple's

`apple.md`'s absolute sizes were set for Apple's viewing distances and their SF Pro rendering. On a
developer's monitor they read small, and the founder called it twice on 2026-07-31. **The sizes here
are a judgement call and no longer track `apple.md`.**

| Token | `apple.md` | Here |
| -- | -- | -- |
| hero-display | 56px | 64px |
| display-lg | 40px | 46px |
| display-md | 34px | 34px |
| lead | 28px | 26px |
| body | 17px | **21px** |
| caption | 14px | 18px |
| fine-print | 12px | 16px |
| nav-link | 12px | 20px |

Line-heights were retuned with them, because Apple's were set for Apple's sizes. `display-md` moved
from 1.47 to 1.25 and `lead` from 1.14 to 1.42 — the first was too loose for a heading, the second
too tight for a lead that wraps to three lines.

Every size is still `calc(Npx * var(--type-scale))`. **`--type-scale` is the one knob**: change it to
move the whole system without disturbing a single ratio. Never edit an individual size to fix one
screen, which re-ramps the ladder.

**Vertical rhythm is part of the type system.** The global reset zeroes every margin, so headings
carry their own `margin-block-end` in `Prose.module.css`. A heading with no bottom margin sits flush
against its paragraph, which is what the ladder looked like before this was fixed.

## Deviation 2: a monospace face

`apple.md` defines no monospace face, because Apple ships no code content. The handoff artifact is
set in **JetBrains Mono**. The typeface switch is content, not chrome.

## Deviation 3: the artifact is a macOS editor window

**Ruled 2026-07-31, and it overrides an earlier line in this file that said "no traffic-light dots".**

The artifact renders as a macOS editor window: a 38px `--editor-chrome` title bar carrying three
traffic lights and a centred filename, over an `--editor-body` code area, at `rounded.md` with the
system's single shadow.

This is a deliberate, contained skeuomorphism. It tells a developer what the artifact *is* before
they read a word of it, which is the whole job of the strongest asset on the site.

It introduces the only colours in the system that are not Apple's: `--mac-close`, `--mac-minimise`,
`--mac-zoom`, `--editor-chrome`, `--editor-body`. **These are a quotation of macOS, not accents.**
They may only appear inside the artifact window. Using any of them elsewhere, or adding a fourth
light, breaks the one-accent rule for real.

## Deviation 4: motion

`apple.md` documents no motion beyond the `scale(0.95)` press. The site adds one effect: content
rises and fades in.

- **Above the fold**, the hero staggers one element at a time, 90ms apart.
- **Below it**, headings and the artifact reveal on scroll via `animation-timeline: view()`.

Constraints that keep this from becoming decoration:

- **It is CSS-only.** No JavaScript, so no hydration flash and nothing to go wrong on a slow client.
- **`@supports` guards the scroll-driven rules.** Where `view()` is unsupported, content is simply
  visible — it never depends on the animation running.
- **The whole block sits inside `@media (prefers-reduced-motion: no-preference)`.**
- **A print rule forces everything visible**, because an un-scrolled reveal would otherwise print blank.
- **It is on `/` and `/handoff` only** — the two pages a visitor actually lands on. Motion everywhere
  is noise.

Hover is still never documented.

## The one thing with no Apple precedent

We have no product photography and cannot produce any. The **handoff artifact panel** occupies the
structural position Apple gives the product render:

- It rests on a **light** tile — `canvas` or `canvas-parchment` — so the dark panel reads as an object
  on a surface. Never place it on a dark tile; it disappears and takes the shadow with it.
- It is the **sole** carrier of the system's one drop-shadow,
  `rgba(0, 0, 0, 0.22) 3px 5px 30px 0`. Nothing else has a shadow. That is Apple's rule kept intact.

## Everything else is `apple.md`

Restated only because these are the rules easiest to break by accident:

- **Canvas is white `#ffffff`**, alternating with parchment `#f5f5f7` and the near-black tiles
  `#272729` / `#2a2a2c` / `#252527`. The surface change **is** the section divider — no borders
  between sections, no gradients anywhere.
- **One accent.** Action Blue `#0066cc` on light surfaces and on filled pills; Sky Link Blue
  `#2997ff` for inline links **on dark tiles only**. That pair is Apple's own, not a second accent.
- **Text follows its tile.** Light tiles use ink `#1d1d1f`; dark tiles use white with `#cccccc`
  secondary. In this implementation each `Tile` sets `--tile-ink`, `--tile-muted`, `--tile-faint`,
  `--tile-link`, `--tile-hairline`, and `--tile-card`, and components read those rather than hardcoding
  a light or dark value. **A component that hardcodes a text colour will be wrong inside half the
  tiles.**
- Weight ladder 300 / 400 / 600 / 700, with **500 absent**.
- `transform: scale(0.95)` is the press state on every button. Hover is never documented.
- Minimum 44 × 44px touch targets.
- Radii `xs` 5px, `sm` 8px, `md` 11px, `lg` 18px, `pill` 9999px. `spacing.md` is 17px.

## Implementation

`apps/site/src/styles/tokens.css` is the machine-readable form and the only place a literal colour may
appear. A hex anywhere else is a bug. Component CSS maps one-to-one onto `apple.md`'s `components:`
block; variants are separate class entries, never conditional props.

The chassis is Apple's two-row nav: a 44px `surface-black` global nav carrying the site links, above a
52px `sub-nav-frosted` at 80% `canvas-parchment` with backdrop blur, carrying the current page name at
`tagline` and the persistent primary pill.

## Known gaps

- Form validation and error states are undocumented in `apple.md` and undocumented here.
- No dark mode. `apple.md` documents the light-dominant system Apple ships by default.
- Data-dense surfaces (the MNE-25 review queue, the MNE-133 conflict UI) need table, diff, and
  empty-state components neither file defines. Extend `apple.md`'s `store-utility-card` grammar there
  rather than improvising.
- The lockup is two drawings, not one (MNE-220). `MneiaLetter` is the bare M that opens the wordmark —
  tight bounds, stroke tuned to the type's weight, so `MNEIA` reads as one word. `MneiaMark` is the
  boxed document glyph for standalone use: favicon, OG, app icon. **Do not put the boxed mark inline
  beside the word** — its container draws a rule between the M and the N, which is the bug MNE-220 fixed.
