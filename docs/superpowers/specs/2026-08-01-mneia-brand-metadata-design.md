# Mneia Brand Mark and Discoverability Design

## Goal

Replace the improvised marketing-site mark with an M-shaped tablet-rune inspired by Mneme/Mnemosyne and use it consistently as the M in the uppercase `MNEIA` wordmark, the browser icon, social previews, and machine-readable company identity.

## Brand direction

The mark is a compact wax-tablet/rune silhouette: a squared tablet frame with a custom M inscription and one electric-blue signal accent. It references ancient memory technology without depicting a deity or copying a classical ornament. The full lockup is the mark followed by `NEIA` in uppercase. It must remain legible at favicon size, in monochrome, and on both black and light surfaces.

## Asset surface

- `MneiaMark` becomes the single inline SVG source for the site navigation and footer.
- The App Router browser icon uses the same mark in a standalone square treatment.
- Open Graph and Twitter metadata point to the existing site preview image, whose alt/copy identifies Mneia as a shared context and handoff layer.

## SEO, AEO, and GEO

- Preserve canonical URLs, robots, sitemap, Open Graph, and Twitter metadata.
- Make the title and description explicitly state what Mneia is, who it serves, and the memory/remembrance positioning without making unsupported product claims.
- Extend JSON-LD with a stable Organization logo URL, WebSite identity, and SoftwareApplication description.
- Keep `llms.txt` and `llms-full.txt` aligned with the same canonical description and entity name so answer engines and generative search systems receive consistent facts.
- Add stable `sameAs` only for verified first-party profiles; do not invent social URLs.

## Verification

- Component tests assert the uppercase wordmark and accessible brand link.
- Route metadata/schema tests assert canonical, logo, description, and crawler-facing fields.
- Browser icon resolves from the built App Router output.
- Run the site typecheck, focused tests, build, scoped Biome, and diff hygiene checks.

