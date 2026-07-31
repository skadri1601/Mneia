---
version: 2.0
name: Mneia-design-language
description: Apple's design language, implemented faithfully, on a black canvas. docs/design/apple.md is the specification — this file records only the surface inversion required to run it dark, and the small number of places where a light-surface token has no meaning on black. Ruled in MNE-168; revised on founder direction to drop the earlier synthesis and follow apple.md exactly.

colors:
  primary: "#0066cc"
  primary-focus: "#0071e3"
  primary-on-dark: "#2997ff"
  on-primary: "#ffffff"
  canvas: "#000000"
  canvas-parchment: "#1d1d1f"
  surface-pearl: "#1d1d1f"
  surface-tile-1: "#272729"
  surface-tile-2: "#2a2a2c"
  surface-tile-3: "#252527"
  surface-black: "#000000"
  surface-chip-translucent: "#d2d2d7"
  ink: "#ffffff"
  body-on-dark: "#ffffff"
  body-muted: "#cccccc"
  ink-muted-80: "#cccccc"
  ink-muted-48: "#7a7a7a"
  divider-soft: "#2a2a2c"
  hairline: "#3d3d41"
---

## What this file is

**`docs/design/apple.md` is the specification.** Read it in full before writing UI. Its typography
ladder, spacing scale, radius scale, component definitions, do/don't rules, and responsive
breakpoints all apply here **exactly as written**, with no reinterpretation.

This file exists only to record the one change: **the canvas is black.** Everything below is the
consequence of that, and nothing below is a licence to diverge further.

> **Superseded 2026-07-31.** Version 1.0 of this file described a synthesis — a dark canvas with an
> amber accent, its own type ramp, and Apple's rules applied selectively. The founder ruled that out:
> the design is to be Apple's, exactly, in black. The amber accent, the bespoke tracking values, and
> the "artifact-first" reframing of the elevation model are all gone. The two references are no
> longer being blended.

## The surface inversion

Apple's palette already contains a full dark set, because Apple's own tiles alternate light and dark.
Running dark-only means **promoting the tokens Apple already defines** rather than inventing values.
Only the light-surface tokens needed replacing:

| Token | `apple.md` | Here | Why |
|---|---|---|---|
| `canvas` | `#ffffff` | `#000000` | The ruling. Pure black, which is also Apple's own `surface-black`. |
| `canvas-parchment` | `#f5f5f7` | `#1d1d1f` | The alternating "other" tile. `#1d1d1f` is Apple's own ink tone, reused as a surface. |
| `surface-pearl` | `#fafafc` | `#1d1d1f` | Secondary-button fill; must read as a button against the canvas. |
| `ink` / `body` | `#1d1d1f` | `#ffffff` | Apple's own `body-on-dark`. |
| `ink-muted-80` | `#333333` | `#cccccc` | Apple's own `body-muted`. A near-black body tone has no meaning on black. |
| `divider-soft` | `#f0f0f0` | `#2a2a2c` | A light hairline is invisible on black. |
| `hairline` | `#e0e0e0` | `#3d3d41` | Same. |

**Unchanged from `apple.md`, deliberately:** `primary` `#0066cc`, `primary-focus` `#0071e3`,
`primary-on-dark` `#2997ff`, `on-primary` `#ffffff`, `surface-tile-1/2/3`, `surface-black`,
`surface-chip-translucent`, `ink-muted-48`, and **every** typography, spacing, radius, shadow, and
breakpoint token.

## Which blue, where

This is the one place the inversion changes behaviour rather than just values, and `apple.md` already
rules on it — no judgement required:

- **Pill CTAs stay Action Blue `#0066cc`.** `apple.md`'s `product-tile-dark` entry says Action Blue
  still works on the dark surface, and the filled pill carries `on-primary` white text.
- **Inline text links use Sky Link Blue `#2997ff`.** `apple.md`: Action Blue *"would disappear
  against the tile background."* Since every surface is now dark, this is the site-wide link colour.
- **The focus ring stays `#0071e3`** at 2px, per `apple.md`.

These are one accent expressed at two lightnesses, exactly as Apple ships it. **There is still no
second accent colour**, and adding one is a violation.

## The two places with no Apple precedent

`apple.md` is a spec for a photography-led consumer catalogue. Two things we ship have no counterpart
in it. Both are resolved by mapping onto Apple's existing structure rather than inventing a new rule:

1. **We have no product photography and cannot produce any.** The **handoff artifact panel** occupies
   the structural position Apple gives the product render: centred in its tile, with clear air around
   it, and it is the **sole** carrier of the system's one drop-shadow —
   `rgba(0, 0, 0, 0.22) 3px 5px 30px 0`. Nothing else in the system has a shadow. That is Apple's rule
   kept intact, not bent.
2. **Apple defines no monospace face**, having no code content. The artifact is set in JetBrains Mono.
   The typeface switch is content, not chrome — every surrounding element still uses the SF Pro ramp.

## Typefaces

`apple.md` prescribes the substitution and we follow it exactly: `SF Pro Display` and `SF Pro Text`
are declared first, so Apple platforms resolve the real thing, with `system-ui` / `-apple-system`
behind them and **Inter** as the final fallback for everything else.

`apple.md`'s letter-spacing values are given in px for SF Pro and are used verbatim — `-0.28px` on
hero display, `-0.374px` on body and 34px display, `0.196px` on lead, `0.231px` on tagline,
`-0.224px` on caption, `-0.12px` on fine print. The Inter `-0.01em` nudge from `apple.md`'s
substitution note is **not** applied, because SF Pro is the declared face and the nudge exists only
for a stack that leads with Inter.

## Implementation

`apps/site/src/styles/tokens.css` is the machine-readable form of both files and is the only place a
literal colour may appear. Every component references `var(--token)`. A hex anywhere else is a bug.

Component CSS maps one-to-one onto `apple.md`'s `components:` block — `button-primary`,
`button-secondary-pill`, `button-store-hero`, `button-dark-utility`, `global-nav`, `sub-nav-frosted`,
the product tiles, `store-utility-card`, `search-input`, `footer`. Variants are separate class
entries, never conditional props.

The chassis is Apple's two-row nav: a 44px `surface-black` global nav carrying the site links at
`nav-link` (12px), above a 52px `sub-nav-frosted` at 80% `canvas-parchment` with backdrop blur,
carrying the current page name at `tagline` (21px/600) and the persistent primary pill.

## Known gaps

- Form validation and error states are undocumented in `apple.md` and undocumented here.
- No light mode. The system is dark-only by ruling.
- Data-dense surfaces (the MNE-25 review queue, the MNE-133 conflict UI) need table, diff, and
  empty-state components neither file defines. Extend `apple.md`'s `store-utility-card` grammar there
  rather than improvising a new one.
- No logo exists. The wordmark is set in `tagline` as an interim treatment.
