# @mneia/site

The marketing site. Five pages, statically generated, no client data fetching.

```
pnpm --filter @mneia/site dev        # next dev
pnpm --filter @mneia/site build      # next build
pnpm --filter @mneia/site typecheck  # tsc --noEmit
```

## Environment

| Variable | Required | Default | Used by |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Production only | `https://mneia.dev` | Canonicals, sitemap, robots, JSON-LD, `llms.txt` |
| `NEXT_PUBLIC_WAITLIST_ENDPOINT` | Yes, to accept signups | none | `WaitlistForm` |
| `NEXT_PUBLIC_SENTRY_DSN` | For browser error reporting | none | `src/instrumentation-client.ts` |
| `SENTRY_DSN` | For server and edge error reporting | none | `sentry.server.config.ts`, `sentry.edge.config.ts` |
| `SENTRY_AUTH_TOKEN` | Build time, for readable stack traces | none | `withSentryConfig` source map upload |

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
| `/opengraph-image` | `lib/og.tsx` | Social card, one per route |
| `/icon` | `app/icon.tsx` | Favicon, and the `Organization.logo` target |

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
4. Add `app/<route>/opengraph-image.tsx`, four lines, copy an existing one
5. Add the heading to `HEADINGS` in `src/lib/og.tsx`

The sitemap and robots pick it up automatically from step 1.
