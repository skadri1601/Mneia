# @mneia/site

The marketing site, and the only place published legal copy lives. Cloudflare Workers via OpenNext.

Root `AGENTS.md` applies. `.claude/rules/design.md` and `docs/design/apple.md` carry the design spec —
**read `apple.md` in full before writing UI.** `docs/BUSINESS.md` carries what may and may not be
claimed here.

## Code Review Rules

### `src/content/legal.ts` is published, not implementation detail

It renders the live Privacy Policy, Terms, Cookie Policy, and the subprocessor table. Review it as a
legal document that happens to be typed.

- A change to a **retention period**, a **data-sharing statement**, or the **subprocessor table** is
  never incidental. Say so prominently and say whether the result is accurate.
- **A diff that adds a third-party service touching user data and leaves the subprocessor table
  alone is a finding**, wherever in the repo that service was added.
- **The waitlist is not a newsletter.** The policy commits the address to one use — telling people
  when access opens — and the confirmation email promises "one more email … nothing else." A new
  send path, a new campaign, or a removed send guard is a finding. Relaxing that wording is a
  founder decision, not a PR decision.
- The 30-day deletion clause after access opens is a live obligation, not a statement of intent.

### Claims we may not make

Self-hostability, offline operation, "content never leaves your machine", and open-core
self-hosting were revoked on 2026-07-28 when the product became hosted-only (§11.1, §15). Flag them
anywhere in copy, metadata, `llms.txt`, or JSON-LD.

Do not advertise the §14 Team tier's feature table before it is true — roles, conflict resolution,
and team handoffs are Month 6. Billing plumbing existing is not the tier being sellable.

### Tokens, never values

Every colour, size, and space comes from `src/styles/tokens.css`. **A literal hex anywhere else is a
bug even when the value is right.** Type sizes are `calc(Npx * var(--type-scale))` — a bare px size
re-ramps the whole ladder.

One accent: Action Blue `--primary` on light surfaces and every filled pill; `--primary-on-dark` for
inline links **on dark tiles only**. No third blue.

### Text follows its tile

Sections alternate light and dark and each `Tile` sets `--tile-ink`, `--tile-muted`, `--tile-faint`,
`--tile-link`, `--tile-hairline`, `--tile-card`. **A component that hardcodes a text colour is wrong
inside half the tiles.**

### One shadow in the system

It belongs to the handoff artifact panel, which rests on a light tile. Never on cards, buttons, nav,
or text. Surface-colour change is the section divider — no borders between sections, no gradients.

### Interaction

Default and active/pressed states only; never document hover. `transform: scale(0.95)` is the press
state on every button. Minimum 44 × 44px touch targets. Variants are separate component entries
(`-active`, `-dark-2`), not conditional props buried in one component.

### Positioning

§16: the page leads with **compaction pain and the handoff artifact**, not "AI memory." The
strongest asset is the artifact itself — no competitor's site can show one.
