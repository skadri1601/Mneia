---
version: 1.0
name: Mneia-design-language
description: The governing design language. A near-black canvas governed by Apple's restraint rules — one accent, one shadow, surface-colour-change as the only divider, zero gradients. Where Apple's system is built around product photography, this one is built around the handoff artifact: it is what the shadow attaches to, what the tiles frame, and what the launch leads with. Ruled in MNE-168 on 2026-07-29.

colors:
  accent: "#ffb340"
  accent-press: "#e89a2e"
  accent-focus: "#ffc466"
  on-accent: "#0a0a0b"
  canvas: "#0a0a0b"
  surface-tile-1: "#141416"
  surface-tile-2: "#0f0f11"
  surface-raised: "#17171a"
  surface-sunken: "#050506"
  ink: "#f5f5f7"
  ink-muted: "#a1a1a8"
  ink-faint: "#6e6e76"
  ink-disabled: "#4a4a52"
  on-raised: "#f5f5f7"
  hairline: "#26262b"
  hairline-strong: "#33333a"
  human: "#ffb340"
  agent: "#a1a1a8"

typography:
  hero-display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.01em
  display-lg:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.01em
  display-md:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.01em
  lead:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: -0.01em
  lead-airy:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 24px
    fontWeight: 300
    lineHeight: 1.5
    letterSpacing: 0
  tagline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: -0.01em
  body-strong:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: -0.01em
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.44
    letterSpacing: -0.01em
  dense-link:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 2.2
    letterSpacing: 0
  caption:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0
  caption-strong:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: 0
  button:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.01em
  button-utility:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.29
    letterSpacing: 0
  fine-print:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0
  nav-link:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: 0
  artifact:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0
  artifact-strong:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 13px
    fontWeight: 700
    lineHeight: 1.65
    letterSpacing: 0
  provenance:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0

rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  pill: 9999px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px
  section-tight: 48px

elevation:
  artifact: "rgba(0, 0, 0, 0.55) 0 12px 40px"

components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: 11px 22px
    minHeight: 44px
  button-primary-press:
    backgroundColor: "{colors.accent-press}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    transform: scale(0.95)
  button-primary-focus:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    outline: 2px solid {colors.accent-focus}
    outlineOffset: 2px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    border: 1px solid {colors.hairline-strong}
    padding: 11px 22px
    minHeight: 44px
  button-ghost-press:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    transform: scale(0.95)
  text-link:
    backgroundColor: transparent
    textColor: "{colors.accent}"
    typography: "{typography.body}"
  global-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.nav-link}"
    height: 56px
    borderBottom: 1px solid {colors.hairline}
  global-nav-scrolled:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink-muted}"
    height: 56px
    backdropFilter: saturate(180%) blur(20px)
  nav-link-active:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
  tile-canvas:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: 80px
  tile-raised:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: 80px
  tile-recessed:
    backgroundColor: "{colors.surface-tile-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: 80px
  artifact-panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-raised}"
    typography: "{typography.artifact}"
    rounded: "{rounded.md}"
    padding: 32px
    border: 1px solid {colors.hairline}
    shadow: "{elevation.artifact}"
  artifact-chrome:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-faint}"
    typography: "{typography.provenance}"
    height: 36px
    padding: 0 16px
  provenance-human:
    backgroundColor: transparent
    textColor: "{colors.human}"
    typography: "{typography.provenance}"
  provenance-agent:
    backgroundColor: transparent
    textColor: "{colors.agent}"
    typography: "{typography.provenance}"
  spec-card:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 24px
    border: 1px solid {colors.hairline}
  price-card:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: 32px
    border: 1px solid {colors.hairline}
  price-card-featured:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 32px
    border: 1px solid {colors.accent}
  input-text:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
    height: 44px
    border: 1px solid {colors.hairline-strong}
  input-text-focus:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    outline: 2px solid {colors.accent-focus}
    outlineOffset: 2px
  eyebrow:
    backgroundColor: transparent
    textColor: "{colors.ink-faint}"
    typography: "{typography.caption-strong}"
  footer:
    backgroundColor: "{colors.surface-tile-2}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.fine-print}"
    padding: 64px
    borderTop: 1px solid {colors.hairline}
---

## Overview

**This is the governing spec.** `apple.md` and `bmw-m.md` are references. Do not build against either
one directly — MNE-168 ruled on 2026-07-29 that neither ships as-is, and that a synthesis is the real
answer rather than a compromise between them.

The synthesis in one sentence: **BMW M's dark canvas, governed by Apple's restraint rules, with the
handoff artifact standing where Apple puts product photography.**

That last clause is the load-bearing one. Apple's system works because a reverent product render
occupies the centre of every tile and the UI recedes so the product can speak. We have no product
photography and cannot produce any. What we have is the thing §16 says the launch must lead with and
§10.3 calls *"the highest-value section and the one nobody else produces"* — a real handoff. So the
artifact takes the structural role of the product render: it is the only element carrying the system's
one shadow, the thing the tiles are built to frame, and the reason the chrome stays quiet.

**Key characteristics:**
- Near-black canvas throughout. `{colors.canvas}` is `#0a0a0b`, not pure black — pure black is reserved
  for `{colors.surface-sunken}`, the artifact's own chrome strip.
- Full-bleed tiles alternate `{colors.canvas}` ↔ `{colors.surface-tile-1}` ↔ `{colors.surface-tile-2}`.
  The surface-colour change is the section divider. There are no borders between sections.
- One accent — amber `{colors.accent}`. Every interactive element uses it and nothing else does.
- Exactly one shadow in the system, on `{component.artifact-panel}`.
- Inter for everything except the artifact, which is JetBrains Mono. That typeface switch is itself a
  signal: mono means *this is the real object, not a description of it*.
- Two provenance colours — `{colors.human}` and `{colors.agent}` — which are the one place a second
  colour is permitted, because §7.1 item 3 makes human-versus-agent authority the distinction that
  matters. `{colors.human}` is the accent hex reused deliberately, not a new colour.

## Why amber

Every product in the §6 competitive map is blue or purple. Amber is not a differentiation gimmick; it
is the colour that survives the two contrast tests that matter on a near-black canvas — as a pill fill
carrying near-black label text, and as link-weight text against `{colors.canvas}`. It also reads
terminal-native to the §5 Stage-1 audience, which is the audience §16 reaches first.

Action Blue `#0066cc` was rejected outright: Apple's own spec concedes it disappears on dark tiles and
introduces Sky Link Blue as a workaround. A system whose single accent needs a second variant to work
on its own canvas has the wrong accent.

## Colors

### Accent

- **Amber** (`{colors.accent}` — #ffb340): The single interactive colour. Pill CTAs, text links, focus
  ring root, and the human-provenance marker. Nothing else in the system is amber.
- **Amber Press** (`{colors.accent-press}` — #e89a2e): The pressed state of a filled pill. Paired with
  `transform: scale(0.95)`, never used alone.
- **Amber Focus** (`{colors.accent-focus}` — #ffc466): Keyboard focus ring only, at 2px with a 2px
  offset so it reads against both canvas and raised surfaces.
- **On Accent** (`{colors.on-accent}` — #0a0a0b): Label text on an amber fill. Near-black, matching the
  canvas — an amber pill reads as a hole punched through to the page beneath.

### Surface

- **Canvas** (`{colors.canvas}` — #0a0a0b): The base. Hero tiles, page background, nav.
- **Tile Raised** (`{colors.surface-tile-1}` — #141416): The alternating band. Spec cards and price
  cards also sit here so they read as part of the tile rhythm rather than as floating chrome.
- **Tile Recessed** (`{colors.surface-tile-2}` — #0f0f11): A micro-step darker. Used where two raised
  tiles would otherwise touch, and for the footer.
- **Raised** (`{colors.surface-raised}` — #17171a): The artifact panel and text inputs. The lightest
  surface in the system, reserved for things you read closely or type into.
- **Sunken** (`{colors.surface-sunken}` — #050506): Near-void. Only the artifact's chrome strip.

### Text

- **Ink** (`{colors.ink}` — #f5f5f7): Every headline and every paragraph. Off-white rather than pure
  white — pure white on near-black is harsh at 17px and glares at display sizes.
- **Ink Muted** (`{colors.ink-muted}` — #a1a1a8): Secondary copy, nav links at rest, footer body.
- **Ink Faint** (`{colors.ink-faint}` — #6e6e76): Eyebrows, captions, legal, artifact chrome.
- **Ink Disabled** (`{colors.ink-disabled}` — #4a4a52): Disabled control labels. The only text tone that
  is permitted to fail AA, because it must read as unavailable.

### Provenance

The one sanctioned exception to the single-accent rule, and only inside the artifact.

- **Human** (`{colors.human}` — #ffb340): Human-asserted and human-confirmed items. Deliberately the
  same hex as `{colors.accent}` — it is the accent reused, not a second colour introduced.
- **Agent** (`{colors.agent}` — #a1a1a8): Agent-asserted items. Muted, because §10.1 step 5 and §10.4
  both rank an unconfirmed agent assertion below a human one, and the colour should say so before the
  label does.

### Hairlines

- **Hairline** (`{colors.hairline}` — #26262b): 1px borders on cards, the artifact panel, the nav
  underline, the footer top edge.
- **Hairline Strong** (`{colors.hairline-strong}` — #33333a): Ghost-button borders and input borders,
  where the line must read as an affordance rather than a container edge.

### Gradients

**None.** Inherited from `apple.md` without modification. Depth comes from surface-colour change and
from the single artifact shadow. If a section feels flat, change its surface token — do not add a
gradient, and do not add a border.

## Typography

### Families

- **Inter** — everything except the artifact. Self-hosted via `next/font`, never fetched at runtime.
- **JetBrains Mono** — the artifact, and provenance markers wherever they appear.

`apple.md`'s substitution note prescribes the adaptation we follow: Inter needs `-0.01em` tracking at
display sizes to approximate SF Pro's tight cadence, and body line-height tightened from 1.47 to ~1.44
because Inter's x-height is taller. Both are applied here.

### Hierarchy

| Token | Size | Weight | Line Height | Tracking | Use |
|---|---|---|---|---|---|
| `{typography.hero-display}` | 56px | 600 | 1.07 | -0.01em | Page hero only, one per route |
| `{typography.display-lg}` | 40px | 600 | 1.10 | -0.01em | Tile headlines |
| `{typography.display-md}` | 34px | 600 | 1.20 | -0.01em | Section heads inside a tile |
| `{typography.lead}` | 28px | 400 | 1.25 | -0.01em | Hero subcopy |
| `{typography.lead-airy}` | 24px | 300 | 1.5 | 0 | Pull quotes. The rare weight 300 |
| `{typography.tagline}` | 21px | 600 | 1.19 | -0.01em | Card titles, wordmark |
| `{typography.body-strong}` | 17px | 600 | 1.24 | -0.01em | Inline emphasis |
| `{typography.body}` | 17px | 400 | 1.44 | -0.01em | Default paragraph |
| `{typography.dense-link}` | 17px | 400 | 2.2 | 0 | Footer link columns |
| `{typography.caption}` | 14px | 400 | 1.43 | 0 | Secondary captions |
| `{typography.caption-strong}` | 14px | 600 | 1.29 | 0 | Eyebrows above headlines |
| `{typography.button}` | 17px | 400 | 1.0 | -0.01em | Pill CTA labels |
| `{typography.button-utility}` | 14px | 400 | 1.29 | 0 | Utility button labels |
| `{typography.fine-print}` | 12px | 400 | 1.4 | 0 | Footer body, legal |
| `{typography.nav-link}` | 14px | 400 | 1.0 | 0 | Nav items |
| `{typography.artifact}` | 13px | 400 | 1.65 | 0 | Handoff artifact body |
| `{typography.artifact-strong}` | 13px | 700 | 1.65 | 0 | Artifact headings |
| `{typography.provenance}` | 11px | 400 | 1.4 | 0 | `[human · confirmed …]` markers |

### Principles

- **Body at 17px, not 16px.** Carried over from Apple unchanged. It sets a reading pace rather than a
  scanning pace, and this site asks people to read.
- **The weight ladder is 300 / 400 / 600 / 700. Weight 500 does not exist.** Inherited from Apple.
- **Negative tracking at 17px and above; zero below.** Never apply negative tracking to the mono faces —
  it destroys the alignment that makes the artifact read as a real file.
- **Line-height 1.65 in the artifact.** Looser than body, because the artifact is scanned for structure
  before it is read for content, and the extra leading is what makes its sections separable at a glance.

## Layout

### Spacing

Base unit 8px. Tokens: `{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.md}` 16 ·
`{spacing.lg}` 24 · `{spacing.xl}` 32 · `{spacing.xxl}` 48 · `{spacing.section}` 80 ·
`{spacing.section-tight}` 48.

Section vertical padding is `{spacing.section}`, dropping to `{spacing.section-tight}` below 640px.
Tiles stack edge-to-edge with zero gap — the colour change is the break.

### Grid

- Max content width 1120px for text-heavy sections; 1280px for card grids; full-bleed for tile
  backgrounds. Content locks at 1280px and margins absorb the rest.
- Card grids: 3 columns → 2 at 833px → 1 at 640px.
- The artifact panel caps at 780px regardless of container, because a monospace block wider than about
  90 characters stops being scannable.

### Whitespace

At least 64px of air above a tile headline and 48px below it. The artifact panel gets 48px clear on
every side — it is the one element permitted to dominate its tile, and crowding it defeats the whole
structural premise of the system.

## Elevation

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, no border | Tiles, nav, footer, body sections |
| Hairline | 1px `{colors.hairline}` | Cards, inputs, the artifact panel's edge |
| Backdrop blur | `saturate(180%) blur(20px)` | `{component.global-nav-scrolled}` only |
| Artifact | `{elevation.artifact}` | `{component.artifact-panel}` — the only shadow in the system |

**One shadow.** Never on a card, never on a button, never on text, never on the nav. If something needs
to feel lifted, move it to `{colors.surface-raised}`. The shadow belongs to the artifact because the
artifact is the product.

## Shapes

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Full-bleed tiles |
| `{rounded.xs}` | 4px | Inline code spans |
| `{rounded.sm}` | 8px | Small chips, artifact chrome corners |
| `{rounded.md}` | 12px | Cards, the artifact panel |
| `{rounded.pill}` | 9999px | Pill CTAs and text inputs — the action grammar |
| `{rounded.full}` | 9999px | Circular controls |

Sharper than Apple's 18px cards, softer than BMW M's 2–6px. 12px is the synthesis point: engineered
without being severe.

## Components

### Navigation

**`global-nav`** — 56px, `{colors.canvas}`, 1px `{colors.hairline}` bottom border. Wordmark left in
`{typography.tagline}`. Links centre-right in `{typography.nav-link}` at `{colors.ink-muted}`, the
current route in `{colors.ink}` via `{component.nav-link-active}`. A single
`{component.button-primary}` right-aligned. Collapses to wordmark + menu at 833px.

**Nav has no Docs entry and no repository link.** The repo is private. Do not add either back without a
ruling that it has been made public.

### Buttons

**`button-primary`** — Amber fill, near-black label, full pill, 11×22px padding, 44px minimum height.
Press: `{component.button-primary-press}` — `{colors.accent-press}` plus `scale(0.95)`.
Focus: `{component.button-primary-focus}` — 2px `{colors.accent-focus}` at 2px offset.

**`button-ghost`** — Transparent, `{colors.ink}` label, 1px `{colors.hairline-strong}` border, same pill
and same metrics. The second CTA when two appear together. It is never amber-bordered — two amber
elements side by side destroy the single-signal rule.

**`text-link`** — `{colors.accent}`, underlined in body copy, unstyled in nav and footer.

### Tiles

**`tile-canvas`** / **`tile-raised`** / **`tile-recessed`** — Full-bleed, zero radius, 80px vertical
padding, no border. Alternate them for section rhythm. Never place two of the same tile type adjacent;
if the content demands it, step through `{component.tile-recessed}` between them.

### The artifact

**`artifact-panel`** — `{colors.surface-raised}`, 12px radius, 1px `{colors.hairline}`, 32px padding,
and `{elevation.artifact}` — the system's only shadow. Body in `{typography.artifact}`. Caps at 780px.

**`artifact-chrome`** — A 36px `{colors.surface-sunken}` strip across the panel top carrying the source
path in `{typography.provenance}` at `{colors.ink-faint}`. It is what makes the panel read as a file
rather than a quote block. Not a browser chrome imitation — no traffic-light dots.

**`provenance-human`** / **`provenance-agent`** — The `[human · confirmed 2026-07-14]` and
`[agent · claude-code · unconfirmed]` markers. Human amber, agent muted grey. This visual distinction is
§7.1 item 3 rendered, and it is the single most important detail on the page: it is the thing no
competitor's site can show, because none of them model the distinction.

### Cards

**`spec-card`** — `{colors.surface-tile-1}`, 12px radius, 1px hairline, 24px padding. Title in
`{typography.tagline}`, body in `{typography.body}`. No shadow.

**`price-card`** / **`price-card-featured`** — 32px padding. The featured variant sits on
`{colors.surface-raised}` with a 1px `{colors.accent}` border. **Exactly one card may be featured**, and
it is not automatically the paid one.

### Inputs

**`input-text`** — `{colors.surface-raised}`, pill radius matching the CTA grammar, 44px height, 1px
`{colors.hairline-strong}`. Focus via `{component.input-text-focus}`.

Placeholder text uses `{colors.ink-faint}`. Never use a placeholder as a label.

### Footer

**`footer`** — `{colors.surface-tile-2}`, 64px padding, 1px `{colors.hairline}` top border. Link columns
in `{typography.dense-link}`, headings in `{typography.caption-strong}`, legal row in
`{typography.fine-print}` at `{colors.ink-faint}`.

## Do's and Don'ts

### Do

- Use `{colors.accent}` for every interactive element and nothing else.
- Alternate tile surfaces for section rhythm — the colour change is the divider.
- Apply `{elevation.artifact}` to the artifact panel and to nothing else, ever.
- Use `transform: scale(0.95)` as the press state on every button.
- Keep body copy at `{typography.body}` — 17px, weight 400.
- Set the artifact in mono. The typeface switch is what signals it is a real object.
- Colour provenance markers: human amber, agent grey.
- Reference `{token.refs}` in every component. A literal hex outside the token file is a bug.

### Don't

- Don't introduce a second accent. `{colors.human}` is the accent reused, not an exception to cite.
- Don't add shadows to cards, buttons, inputs, nav, or text.
- Don't use gradients. If a section feels flat, change its surface token.
- Don't use weight 500 — the ladder is 300 / 400 / 600 / 700.
- Don't round full-bleed tiles.
- Don't place two identical tile surfaces adjacent.
- Don't apply negative tracking to the mono faces.
- Don't put a border between sections. That is what the surface change is for.
- Don't feature more than one price card.
- Don't add a Docs link or a repository link while the repo is private.

## Responsive

| Breakpoint | Changes |
|---|---|
| ≥ 1281px | Content locks at 1280px, margins absorb the rest |
| 1024–1280px | Full layout, 3-column card grids |
| 834–1023px | Card grids drop to 2 columns; hero drops to 40px |
| 641–833px | Nav collapses to wordmark + menu; single-column tiles |
| 481–640px | Section padding tightens to `{spacing.section-tight}`; hero drops to 34px |
| ≤ 480px | Hero drops to 28px; artifact panel padding drops to 16px and scrolls horizontally inside its own container |

The artifact panel never reflows its content. Below 780px it scrolls horizontally **inside its own
container** — the page body never scrolls sideways. A rewrapped monospace artifact is a lie about what
the file looks like.

### Touch targets

Minimum 44 × 44px everywhere. `{component.button-primary}` and `{component.button-ghost}` both declare
a 44px minimum height explicitly rather than relying on padding arithmetic.

## Iteration guide

1. One component at a time. Reference its YAML key directly.
2. Variants are separate entries (`-press`, `-focus`, `-featured`), never conditional props.
3. `{token.refs}` everywhere. Never inline hex.
4. Never document hover. Default and pressed only.
5. The single shadow is reserved for the artifact panel.
6. When in doubt about emphasis, change the surface before adding chrome.

## Known gaps

- Error and validation states are undocumented — the only input in the system is the waitlist field.
- No light mode. The system is dark-only by ruling, not by omission. A light counterpart would need its
  own spec and its own ruling.
- Data-dense surfaces (the MNE-25 review queue, the MNE-133 conflict UI) will need table, diff, and
  empty-state components this spec does not yet define. Extend it there rather than improvising.
- The wordmark is set in `{typography.tagline}` as an interim treatment. No logo exists yet.
