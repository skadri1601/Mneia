# Mneia Brand Mark and Discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved tablet-rune M mark with uppercase `NEIA`, a matching browser icon, and consistent SEO, AEO, and GEO identity metadata for the marketing site.

**Architecture:** Keep the mark as a deterministic inline SVG so it remains sharp and themeable. Reuse the same geometry for the App Router icon and schema logo target. Extend the existing site metadata, JSON-LD, corpus, robots, and sitemap surfaces without inventing unverified social profiles.

**Tech Stack:** Next.js App Router, React, TypeScript, SVG, JSON-LD, Vitest, Biome.

---

### Task 1: Replace the marketing lockup with the tablet-rune MNEIA mark

**Files:**
- Modify: `apps/site/src/components/MneiaMark.tsx`
- Modify: `apps/site/src/components/Nav.tsx`
- Modify: `apps/site/src/components/Nav.module.css`
- Modify: `apps/site/src/components/Nav.test.tsx`
- Modify: `apps/site/src/components/Footer.tsx`
- Modify: `apps/site/src/components/Footer.module.css`

- [ ] **Step 1: Write the failing component assertions**

Assert that the navigation exposes a brand link whose accessible name is `MNEIA`, that the inline mark has a stable title-independent SVG viewBox, and that the rendered lockup contains uppercase `NEIA` rather than the old mixed-case text.

- [ ] **Step 2: Run the focused component test**

Run: `node node_modules\\vitest\\vitest.mjs run apps/site/src/components/Nav.test.tsx`

Expected: FAIL because the current lockup still renders `Mneia` and the existing mark geometry is not the approved tablet-rune design.

- [ ] **Step 3: Implement the deterministic SVG lockup**

Use a squared tablet outline with a centered angular M inscription, white primary strokes, and one `var(--mark-signal)` blue accent. Render `NEIA` as uppercase text immediately after the mark, keep the link label `MNEIA`, and size the mark from the existing 21px nav token. Apply the same lockup to the footer without changing layout heights.

- [ ] **Step 4: Run the component tests and site typecheck**

Run: `node node_modules\\vitest\\vitest.mjs run apps/site/src/components/Nav.test.tsx`

Run: `pnpm --filter @mneia/site typecheck`

Expected: all focused tests pass and TypeScript exits 0.

### Task 2: Add the matching browser icon

**Files:**
- Create: `apps/site/src/app/icon.svg`
- Modify: `apps/site/src/app/icon.png` only if the App Router reports a metadata-route conflict
- Test: `apps/site/src/app/layout.test.tsx` or a focused icon-resolution test if the repository already exposes one

- [ ] **Step 1: Add the standalone SVG icon**

Create a square SVG using the same tablet-rune geometry, with no wordmark, no text, and the blue accent on a black-compatible background. Keep the `viewBox` at `0 0 64 64` and use accessible decorative semantics appropriate for a favicon.

- [ ] **Step 2: Build the site to verify icon resolution**

Run: `pnpm --filter @mneia/site build`

Expected: the App Router build succeeds and emits the icon route without a duplicate icon conflict.

### Task 3: Align SEO, AEO, and GEO identity surfaces

**Files:**
- Modify: `apps/site/src/lib/site.ts`
- Modify: `apps/site/src/lib/schema.ts`
- Modify: `apps/site/src/lib/corpus.ts`
- Modify: `apps/site/src/app/layout.tsx`
- Modify: `apps/site/src/app/llms.txt/route.ts` only if it has route-local copy
- Modify: `apps/site/src/app/llms-full.txt/route.ts` only if it has route-local copy
- Modify: `apps/site/src/components/Nav.test.tsx` or add focused tests beside the changed metadata helpers

- [ ] **Step 1: Write failing metadata assertions**

Assert that the canonical site description names Mneia as a shared context and handoff layer for AI-assisted teams, that the Organization schema points at the canonical icon URL, and that corpus/LLM output uses the exact uppercase entity name `MNEIA`.

- [ ] **Step 2: Implement consistent discoverability copy**

Update the shared title/description constants and schema helpers. Keep canonical URLs, robots directives, sitemap entries, Open Graph, and Twitter metadata intact. Add only verified first-party identity fields; do not fabricate `sameAs` URLs. Keep claims concrete: memory, context, checkpoints, rehydration, and handoffs.

- [ ] **Step 3: Run metadata tests and inspect generated output**

Run: `node node_modules\\vitest\\vitest.mjs run apps/site/src/lib apps/site/src/components/Nav.test.tsx`

Run: `pnpm --filter @mneia/site build`

Expected: focused tests pass; build succeeds; generated metadata contains canonical, Open Graph, Twitter, JSON-LD, robots, sitemap, and llms output.

### Task 4: Final verification

- [ ] Run: `pnpm --filter @mneia/site typecheck`
- [ ] Run: `pnpm --filter @mneia/site build`
- [ ] Run: `node_modules\\.bin\\biome.CMD check apps/site/src`
- [ ] Run: `pnpm check:tests`
- [ ] Run: `git diff --check`
- [ ] Confirm the browser icon, uppercase lockup, and metadata all use the same tablet-rune identity.

