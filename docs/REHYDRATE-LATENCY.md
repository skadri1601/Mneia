# Rehydrate latency — the §12.1 budget measured

MNE-175 asked one question: **is the 300ms p95 rehydrate budget reachable over the network?** §12.1
wrote that budget assuming a local store. §11.1 made the store hosted, which turned an assumption
into a risk nobody had measured.

Measured 2026-08-08. **The answer is no, not as written.**

Reproduce both halves yourself:

```
pnpm latency:rehydrate --runs=20          # the network half, against app.mneia.dev
DATABASE_URL=... pnpm test tests/integration/rehydrate-budget.integration.test.ts
```

## What was measured

| Half | How | p50 | p95 |
|---|---|---|---|
| Store and ranking, no network | `assembleSlice` over a 2,000-item corpus with embeddings, `pgvector/pgvector:pg18` on localhost, 30 runs after 5 warmups | 131ms | **166ms** |
| Network, connection reused | `GET /api/health` on `app.mneia.dev`, keep-alive, 20 runs | 141ms | **187ms** |
| Network, new TLS connection | same, fresh socket each run | 186ms | 202ms |
| TLS handshake alone | DNS + TCP + TLS on a fresh socket | 43ms | 51ms |

Naively summed: **353ms p95**, against a 300ms budget.

## Three things that make the real number worse, not better

1. **The store half was measured on localhost, not Neon.** Production reaches Postgres over the
   network too, and `assembleSlice` issues three concurrent queries plus an `actorTeamIds` lookup.
   The 166ms figure is a floor for that half, not an estimate of it.
2. **`/api/health` is not an empty endpoint.** It queries Postgres and inspects the RLS posture, so
   the 187ms warm figure is not pure transit — but it is also not doing a slice's work. It is the
   closest honest proxy available without a token.
3. **The authenticated path is still unmeasured.** `POST /api/v1/rehydrate` needs a real token. The
   script measures it when `MNEIA_TOKEN` and `--project=` are supplied, and nobody has run that yet.
   Until someone does, the end-to-end number is inferred rather than observed.

Latency is also measured from one machine in one place. A colleague on another continent gets a
different network half and the same store half.

## What this means

The budget cannot be met by tuning the ranker. The store half at 166ms already sits inside a network
half of 187ms, and **neither half alone is the problem — their sum is.** Three ways out, none of them
an implementation detail:

- **Keep the wording and miss it.** A 353ms p95 that nobody measures is how §12.1 quietly becomes
  decoration. Not recommended, and named here so it is not chosen by default.
- **Restate the budget against what the caller actually feels.** A warm connection and a
  second-call-onward measurement is a defensible definition, and it is what an MCP server holding an
  open connection across a session really experiences. This is a **founder call**, because §12.1's
  number is a published promise about the product, not a variable.
- **Cache.** MNE-175 says explicitly: *measure before building a cache.* The measurement now exists
  and it argues for one — but a cache over tenant rows is where workspace isolation gets broken by
  accident, so it needs its own ticket and its own RLS review, not a quiet addition here.

**The 300ms figure in §12.1 and in `AGENTS.md`'s standing rule 4 should not be treated as satisfied.**
It is currently unmet on the hosted path, and this file is the evidence.

## The regression gate that does exist

`tests/integration/rehydrate-budget.integration.test.ts` asserts the **store and ranking half** stays
under 300ms and fails the build otherwise. It runs in `database.yml` against a throwaway container,
so a ranker or query regression is caught even though the end-to-end budget is a separate, open
question. The test says so in its own failure message rather than implying the product budget is met.

That gate is also what caught the semantic-search defect on 2026-08-08: `selectContextItems` built a
bare `workspace_id = $1` while joining `context_item_embedding`, which carries the same column, so
**every rehydrate with a task embedding failed outright** with `column reference "workspace_id" is
ambiguous`. Nothing else exercised that path against a real engine. The benchmark paid for itself
before it measured anything.
