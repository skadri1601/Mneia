---
paths:
  - "apps/web/**"
  - "apps/site/**"
  - "**/*.tsx"
  - "**/*.css"
  - "**/tailwind.config.*"
---

# Design rules

## The reference specs

Two complete design languages live in `docs/design/`. Read the relevant one **in full** before
writing UI — they are token specs, not mood boards, and they carry do/don't rules that are easy to
violate by accident.

| File | Language |
|---|---|
| `docs/design/apple.md` | Light-dominant, photography-first. Single Action Blue accent, SF Pro, pill CTAs, alternating light/dark full-bleed tiles, exactly one drop-shadow in the whole system. |
| `docs/design/bmw-m.md` | Near-black canvas, uppercase BMW Type Next display, M tricolor as sparing signature, sharp 2–6px radii, engineered rather than bombastic. |

**Which one is not yet decided** — MNE-168. Until it closes, do not pick one implicitly by building
UI. Ask.

## When this matters

Nothing in M0, M1, or M2 renders a pixel. The surfaces that consume these specs are:

- **MNE-120** — landing page and docs site (M3)
- **MNE-25** — web review app (M4)
- **MNE-133** — conflict resolution UI (M4)

Adopting a design system before there is a surface to apply it to is the same premature-infrastructure
mistake as standing up Kubernetes in week one. File it, do not build it.

## Rules that hold whichever language wins

- **Tokens, never inline hex.** Both specs use `{token.refs}` throughout. Match that — a hardcoded
  `#0066cc` is a bug even when the value is right.
- **One accent colour.** Apple enforces this explicitly; BMW M's tricolor is a brand signature, not a
  UI palette. Neither has a second "click me" colour.
- **Default and active/pressed states only.** Both specs say never document hover. Follow it.
- **Minimum 44 × 44px touch targets.**
- **Variants are separate component entries** (`-active`, `-focus`, `-dark-2`), not conditional props
  buried in one component.

## The web app stays thin

§4 calls it *"a thin web app for team review and conflict resolution,"* and §19 rules out a chat
interface or an agent of our own. **Thin is the specification, not a hedge.**

The developer inner loop stays in the terminal and the editor. The web app exists only for what a CLI
is genuinely bad at: reviewing a queue, comparing two conflicting items side by side, and browsing a
decision timeline.

If a feature would pull daily work out of the CLI and into the browser, that is a scope question —
run the `scope-check` skill.

## Positioning constraint

§16: the launch leads with **compaction pain and the handoff artifact**, not "AI memory." Whatever
the design language, the landing page's job is to make a developer recognise their own Tuesday
morning (§2.1) and then show them a real handoff.

The strongest asset on that page is the artifact itself. No competitor's site can show one.
