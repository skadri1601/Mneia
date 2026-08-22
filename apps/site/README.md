# @mneia/site

The marketing site. Five pages, statically generated, no client data fetching.

```
pnpm --filter @mneia/site dev        # next dev
pnpm --filter @mneia/site build      # next build
pnpm --filter @mneia/site typecheck  # tsc --noEmit
```

## Deployment — Cloudflare Workers, via OpenNext

`wrangler.jsonc` and `open-next.config.ts` are the whole story. MNE-195 ruled the host and MNE-165
confirmed it: this site is a Worker, `apps/web` is a DigitalOcean droplet, and Cloudflare fronts both.

**Vercel is gone.** The root `vercel.json`, its legacy `builds` array, and the long explanation of why
that array had to stay were removed on 2026-08-02 once the Vercel project was torn down. If you are
reading this in a diff and wondering where that section went: it documented a workaround for a
platform we no longer deploy to. `mneia.dev` is served by the Worker — `curl -I https://mneia.dev`
answers `Server: cloudflare`.

The environment tag on error reports comes from `src/lib/environment.ts`, which reads
`NEXT_PUBLIC_MNEIA_ENV`. **`wrangler.jsonc` declares that in `vars`**, so the value is set on the
deployment rather than inferred from it. That is the MNE-212 fix: the tag used to be read from
`VERCEL_ENV`, a variable no runtime we deploy to defines, so every production error arrived tagged
`development` — and the replacement fallback only ever agreed with reality by accident, because
`next build` folds `NODE_ENV` to `production` in a preview build too.

OpenNext copies every Worker var into `process.env` before the Next handler runs, so the server and
edge configs read the declared value at runtime and a staging Worker can be retagged without a
rebuild. The browser bundle has no Worker env; its value is inlined at build time and falls back to
the same `production` literal.

## Environment

| Variable | Required | Default | Used by |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Production only | `https://mneia.dev` | Canonicals, sitemap, robots, JSON-LD, `llms.txt` |
| `NEXT_PUBLIC_WAITLIST_ENDPOINT` | Yes, to accept signups | none | `WaitlistForm` |
| `NEXT_PUBLIC_SENTRY_DSN` | For browser error reporting | none | `src/instrumentation-client.ts` |
| `SENTRY_DSN` | For server and edge error reporting | none | `sentry.server.config.ts`, `sentry.edge.config.ts` |
| `SENTRY_AUTH_TOKEN` | Build time, for readable stack traces | none | `withSentryConfig` source map upload |
| `SENTRY_PROBE_SECRET` | Only to run the error-capture probe | none | `POST /api/sentry-check` — unset means the route 404s |
| `NEXT_PUBLIC_MNEIA_ENV` | Set on the Worker, in `wrangler.jsonc` `vars` | `production` under `next build`, `development` under `next dev` | The Sentry `environment` tag on every event |

`NEXT_PUBLIC_SITE_URL` must have no trailing slash and must match the domain the site is actually
served from. Every absolute URL the site emits is derived from it, so a wrong value points canonicals
and structured data at a host that does not exist.

## Error reporting

Sentry runs across all three Next runtimes — browser, Node, and Edge — initialised from
`src/instrumentation-client.ts`, `sentry.server.config.ts`, and `sentry.edge.config.ts`. The server
and edge configs are loaded by `src/instrumentation.ts`, which also exports `onRequestError` so
Server Component and route handler failures are captured without a `captureException` at every call
site. `src/app/global-error.tsx` exists because Next catches root layout errors before Sentry ever
sees them, so that boundary has to report explicitly.

**The SDK is `@sentry/nextjs` everywhere, including on Cloudflare Workers.** This is Sentry's
supported configuration for Next.js on Workers and it needs two things from `wrangler.jsonc`, both
already set: the `nodejs_compat` compatibility flag, and a `compatibility_date` of `2025-08-16` or
later — the date that introduced `https.request` to `workerd`, which the SDK needs to send events.
Do not lower either.

**`global-error.tsx` imports from `@sentry/browser`, not `@sentry/nextjs`, and that is load-bearing.**
It is a `'use client'` component, so Next server-renders it too — and on the server pass
`@sentry/nextjs` resolves to the *Node* SDK, dragging OpenTelemetry and forty-odd Node
instrumentations into the Worker for a boundary that only ever reports from the browser. That single
import cost **529 KiB gzipped**, a sixth of the entire Worker budget. `@sentry/browser` is the same
client the page already has: `@sentry/nextjs` depends on it, and both carry the same `^10.69.0`
range, so pnpm resolves them to one copy, webpack emits one module, and `captureException` finds the
client `instrumentation-client.ts` initialised. The `global-error` chunk is 6 KiB as a result.
**Keep the two ranges in step** — Sentry's global client registry is keyed by SDK version, so letting
them resolve to different versions would split the registry and silently stop this boundary
reporting. And **do not "unify" this import back to `@sentry/nextjs`.**

**Worker bundle size, measured on MNE-198** — `wrangler deploy --dry-run` after `pnpm build:cf`:

| Configuration | Raw | Gzipped | Headroom under 3 MiB |
|---|---|---|---|
| Before MNE-198 | 12888 KiB | **3032 KiB** | 40 KiB |
| After MNE-198 | 10740 KiB | **2503 KiB** | 569 KiB |
| With MNE-222's consent gate | 11068 KiB | **2538 KiB** | 534 KiB |
| Now, with MNE-240's `/api/sentry-check` | 11113 KiB | **2541 KiB** | 531 KiB |

Cloudflare's hard limit is **3072 KiB gzipped** and validation fails with `code: 10027`. Re-measure
with `pnpm exec wrangler deploy --dry-run` before adding any server-side dependency.

**`@sentry/cloudflare` was evaluated on MNE-198 and rejected — do not swap to it.** It is genuinely
smaller: routing the server and edge paths through it measured 2085 KiB gzipped, another 418 KiB
below where we are now. It was rejected on correctness, not size. It has no `init()`, so it only
initialises by wrapping the Worker's `fetch` export via `withSentry` — and at the time this site also
deployed to **Vercel**, where that entry point does not exist, so every server-side `captureException`
would have become a silent no-op there. It also has no `captureRequestError`, which is what gives
`onRequestError` its Next-specific context. 418 KiB was not worth it against 569 KiB of headroom.

**Revisited on MNE-222's branch, 2026-08-05, and the rejection stands.** The Vercel half of the
argument did die with the Vercel project on 2026-08-02, so only the `captureRequestError` objection
survives — but it survives intact, and the size case that would have outweighed it got weaker rather
than stronger. Headroom is **534 KiB** against the 418 KiB the swap would return, so trading
`onRequestError`'s Next-specific request context for margin we already have is a bad trade. Revisit
again only if headroom drops below roughly 200 KiB.

**What is now known about whether this SDK works on `workerd` at all**, because MNE-198 opened by
assuming it was "very likely silently degraded or dead":

- It is **not** dead. Sentry issue `JAVASCRIPT-NEXTJS-3` was captured with `runtime.name: cloudflare`
  through `auto.node.onunhandledrejection` and delivered — the SDK initialises, hooks the runtime,
  and transports from inside workerd.
- That event came from `wrangler dev`, not from the deployed Worker: `server_name: localhost`, and
  the frames are `.wrangler/tmp/dev-*/worker.js`.
- **No event tagged `environment: production` has ever reached this project.** All 14 events in the
  last 30 days are `development`. That is consistent with a static marketing site genuinely not
  erroring, and equally consistent with production capture being broken, and the two cannot be told
  apart from the outside.

Settling it needs a deliberate error thrown on the deployed Worker. **`POST /api/sentry-check` is
that route, and it is permanent** — see below.

### `/api/sentry-check`, the guarded probe

A permanent operational check (MNE-240), not scaffolding to delete. "No production event has ever
arrived" is only meaningful if you can make one arrive on demand; without this route the two readings
above stay indistinguishable forever.

**It is inert unless `SENTRY_PROBE_SECRET` is set**, and it answers `404` — never `401` — to a
missing or wrong secret, so it does not confirm its own existence to a scanner. That matters: a bare
public route here is a way to burn the project's Sentry quota. The comparison is constant-time over
encoded bytes; `src/lib/probe.test.ts` covers the prefix, superstring, case, and multi-byte cases a
naive `===` or `startsWith` would let through.

| | |
|---|---|
| Method | `POST` only |
| Header | `x-mneia-probe: $SENTRY_PROBE_SECRET` |
| `?marker=` | Free text echoed into the error message, so you can find *your* event |
| `?mode=throw` | Throws instead of capturing, exercising `onRequestError` rather than `captureException` |

Default mode returns `{ eventId, delivered, environment, marker }`. `delivered` is the result of
`Sentry.flush()` — load-bearing on Workers, which can terminate before an in-flight event is sent, so
a `true` here means the transport actually completed rather than merely being queued.

```
curl -sS -X POST "https://mneia.dev/api/sentry-check?marker=$(date +%s)" \
  -H "x-mneia-probe: ${SENTRY_PROBE_SECRET}"
```

Then confirm in Sentry that the event is tagged `environment: production` and that the stack names
first-party frames. Run it after any change to the Sentry wiring, the `wrangler.jsonc` compatibility
flags, or the SDK version — all three have broken capture before.

**`includeLocalVariables` was removed on MNE-198 because it never worked on `workerd`.** It is a
`@sentry/node` option that needs `node:inspector`. Under `nodejs_compat` that module *imports* — which
is why this looked fine — but `new inspector.Session()` throws `ERR_METHOD_NOT_IMPLEMENTED`, verified
against `workerd` directly. Sentry catches that and reports it through `debug.log`, which
`excludeDebugStatements` strips, so the failure was completely silent. There is no `workerd`
equivalent, so it cannot be made to work. `dataCollection.stackFrameVariables` and `frameContextLines`
are kept verbatim to preserve the block's exact semantics, but they are Node-oriented too and are
inert on Workers for the same reason.

**Errors only — tracing is deliberately off.** `excludeTracing` in `next.config.ts` strips the
tracing bundle, which is worth 52 kB of client JS on every page. On 18 prerendered static pages the
Web Vitals and navigation spans it buys are not worth that against the Core Web Vitals the discovery
work depends on. Re-enabling means removing `excludeTracing` **and** restoring `tracesSampleRate` in
all three configs — a sample rate alone does nothing once the bundle is stripped.

**`dataCollection` is set deliberately, and its default is a trap.** Omitting the option entirely
falls back to `sendDefaultPii` (default `false`); passing the object — *even empty* — flips every
unset category to its permissive default. Only `userInfo` defaults to `false`, and it is the category
that carries the visitor's **IP address**. The configs set it to `true` on purpose, so events carry
IP, OS name and version, device, and browser. Do not "tidy" these blocks away — deleting them
silently narrows what is captured, and setting `dataCollection: {}` silently widens it.

Collecting IP addresses is a privacy commitment, not just a config value. It needs a privacy policy
that says so before the site takes real traffic, and it can be reversed at any time from Sentry's
project settings (*Security & Privacy → Prevent Storing of IP Addresses*) without a deploy.

## Where the copy lives

**`src/content/pages.ts` is the single source for every sentence on the site.** Pages import from it,
and so does `src/lib/corpus.ts`, which generates the plain-text `/llms.txt` and `/llms-full.txt` that
answer engines read. Editing copy in a `page.tsx` instead of the content module silently desynchronises
what a human reads from what a model is told, which is the failure this structure exists to prevent.

Paragraphs are modelled as `Segment[]` so a bolded run survives into the plain-text corpus as text:

```ts
[{ text: 'The inner loop stays in your terminal.', strong: true }, { text: ' A handoff that ...' }]
```

**Legal copy is the one exception, and it lives in `src/content/legal.ts`.** Terms and the Privacy
Policy are structured as sections of typed blocks — text, bullets, tables, notes — because a document
of that length is authored and reviewed as a document, not as marketing copy. It uses the same
`Segment[]` model underneath, via a `rich()` helper that parses `**bold**` so a clause can be written
as one string instead of a hand-built array.

Legal pages appear in `ROUTES`, so `sitemap.xml` and the `llms.txt` index list them. They are
deliberately **not** in `llms-full.txt` — `corpus.ts` builds that from an explicit array, and twenty
thousand words of clauses would drown the product copy the corpus exists to deliver.

## Discovery surfaces

Generated, never hand-edited. All of them derive from `ROUTES` in `src/lib/site.ts`.

| Route | Source | Purpose |
|---|---|---|
| `/sitemap.xml` | `app/sitemap.ts` | Crawl index |
| `/robots.txt` | `app/robots.txt/route.ts` | Crawl policy, including an explicit ruling per AI crawler |
| `/llms.txt` | `lib/corpus.ts` | Short summary plus a page index, per the llms.txt convention |
| `/llms-full.txt` | `lib/corpus.ts` | The whole site as plain text in one request |
| `opengraph-image.png` | committed PNG, one per route | Social card |
| `icon.png` | committed PNG | Favicon, and the `Organization.logo` target |

JSON-LD is assembled in `src/lib/schema.ts` and rendered by `<JsonLd>`. `Organization`, `WebSite`, and
`SoftwareApplication` are emitted once sitewide from the layout; pages add only `WebPage`,
`BreadcrumbList`, and `FAQPage`. **Do not re-emit a sitewide node from a page** or the same `@id`
appears twice in the document.

`FAQPage` entries are rendered visibly by `<FaqList>` from the same constant that feeds the structured
data. Structured data that is not on the page is cloaking, and Google treats it as a manual-action
offence rather than a technicality.

## Adding a page

1. Add the route to `ROUTES` in `src/lib/site.ts` with a title, a description of roughly 150
   characters, and a priority
2. Add its copy to `src/content/pages.ts`, and add it to `src/lib/corpus.ts`
3. Add `app/<route>/page.tsx` with `export const metadata = pageMetadata('/<route>')`
4. Add `app/<route>/opengraph-image.png` and `app/<route>/opengraph-image.alt.txt` — see
   *Social images are committed PNGs* below, which explains where the PNG comes from

The sitemap and robots pick it up automatically from step 1.

## Social images are committed PNGs — do not move them back to `next/og`

`opengraph-image.png`, `icon.png` and their `.alt.txt` siblings are **committed build artifacts**, and
that is deliberate. Generating them at request time with `ImageResponse` is the obvious, idiomatic
Next.js approach. It also makes the site undeployable.

`next/og` links a raster engine into the **server** bundle — `resvg.wasm` at 516 KiB gzipped, plus
`yoga.wasm` and a Noto subset, ~558 KiB gzipped in total. A Cloudflare Worker on the free plan may not
exceed **3 MiB gzipped**. With `next/og` the Worker measured **3308 KiB — 236 KiB over**, and every
deploy failed validation with `code: 10027` while the build itself passed. MNE-196 has the numbers.

The engine bought us nothing at runtime: all six routes were already `○ (Static)`, so Next prerendered
the PNGs at build time and the Worker shipped a renderer it never called. As committed files they are
**static assets**, which do not count against the Worker limit at all.

**To change a card's design or add one, restore the generator, render, and re-commit the output:**

```
git show e1a894c:apps/site/src/lib/og.tsx > src/lib/og.tsx      # the JSX that drew them
git show e1a894c:apps/site/src/app/opengraph-image.tsx > src/app/opengraph-image.tsx
pnpm build                                                       # Next prerenders every card
cp .next/server/app/opengraph-image.body src/app/opengraph-image.png
rm src/lib/og.tsx src/app/opengraph-image.tsx                    # then delete them again
```

The last line is the one that matters. `OG_PALETTE` in `src/styles/theme.ts` is kept for exactly this
reason — it is the record of the colours the committed PNGs were drawn with.
