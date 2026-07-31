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

## Deviation 1 — the type scale

**Every size in `apple.md`'s ladder is multiplied by `--type-scale`, currently `1.15`.**

Apple's absolute sizes were set for Apple's own viewing distances and their SF Pro rendering. On a
developer's monitor, running the ladder at its literal values read too small — the founder called it
on 2026-07-31 after seeing it in a browser.

This is a **scale**, not a re-ramp. Every ratio in `apple.md` is preserved exactly: body still sits
one step above caption, hero display still sits at 4× fine print, and the relationships that make the
hierarchy legible are untouched. Only the multiplier changed, and it is **one token in one file**:

```css
--type-scale: 1.15;
--size-body: calc(17px * var(--type-scale));   /* 19.55px rendered */
```

To retune the whole system, change that number. Do not adjust individual sizes — that re-ramps the
ladder and is how a type system drifts.

**Letter-spacing is not scaled.** `apple.md` gives tracking in px and those values are used verbatim.
At a 1.15 multiplier the optical difference is negligible, and scaling tracking alongside size would
overshoot Apple's intent at display sizes.

**Line-heights are not scaled** either — they are unitless ratios and scale themselves.

## Deviation 2 — a monospace face

`apple.md` defines no monospace face, because Apple ships no code content. The handoff artifact is
set in **JetBrains Mono**. The typeface switch is content, not chrome: every element surrounding the
artifact still uses the SF Pro ramp.

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
- No logo exists. The wordmark is set in `tagline` as an interim treatment.
