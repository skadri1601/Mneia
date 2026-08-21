#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const require = createRequire(import.meta.url);
const { Pool } = require('pg');

const { assembleSlice, EMBEDDING_DIMENSIONS, PostgresStoreAdapter, WORKSPACE_SETTING } =
  await import('../packages/core/dist/index.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
};
const numberFlag = (name, fallback) => {
  const raw = flag(name, null);
  if (raw === null) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    process.stderr.write(
      `rehydrate-budget: --${name} must be a positive number; received ${JSON.stringify(raw)}\n`,
    );
    process.exit(2);
  }
  return value;
};

const P95_BUDGET_MS = 300;
const WARN_FRACTION = 0.8;

const SIX_MONTH_ITEM_COUNT = 8000;

const CORPUS_DERIVATION = [
  'Corpus size, and why it is not a round number picked to pass:',
  '',
  '  vision.md §11.2 sizes a project at "hundreds to low thousands of items". That is the',
  '  assumption the embedding decision was made under, so a gate that only tests inside it',
  '  proves nothing about the six-month case §12.1 has to survive.',
  '',
  '  Measured yield, production, MNE-265: a 1,357-turn Claude Code session returned 7',
  '  candidates; an 18-turn session returned 1. So real extraction produces roughly 1 item',
  '  per 20-190 transcript turns, not per commit.',
  '',
  '  Cadence, this repo: 218 commits over 24 days (2026-07-28 to 2026-08-20) with two agent',
  '  lanes running, so ~9 task boundaries a day. At 2-7 items per boundary that is 18-63',
  '  items a day, and §9 is bi-temporal - superseding an item writes a row, it never removes',
  '  one, so six months of history all stays in the table.',
  '',
  '  130 working days x 18-63 items = 2,340 to 8,190 items for ONE project. This repo at 24',
  '  days sits at the bottom of that band, which is why the 2,000-item corpus in',
  '  rehydrate-budget.integration.test.ts reads as a one-month corpus. A funded team of five',
  `  sits at the top of it. The gate takes the top: ${SIX_MONTH_ITEM_COUNT} items.`,
].join('\n');

const items = Math.floor(numberFlag('items', SIX_MONTH_ITEM_COUNT));
const warmup = Math.floor(numberFlag('warmup', 25));
const runs = Math.floor(numberFlag('runs', 60));
const batches = Math.floor(numberFlag('batches', 3));
const tokenBudget = Math.floor(numberFlag('token-budget', 4000));
const budgetMs = numberFlag('budget-ms', P95_BUDGET_MS);
const seed = Math.floor(numberFlag('seed', 20260820));
const asJson = args.includes('--json');
const skipSeed = args.includes('--no-seed');
const explain = args.includes('--explain');

if (explain) {
  process.stdout.write(`${CORPUS_DERIVATION}\n`);
  process.exit(0);
}

const connectionString = process.env.DATABASE_URL;

if (connectionString === undefined || connectionString === '') {
  process.stderr.write(
    'rehydrate-budget: expected DATABASE_URL to hold a Postgres connection string; found none.\n' +
      '  This benchmark needs a real engine with pgvector, and a throwaway one is enough:\n' +
      '    docker run -d --name mneia-bench-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mneia \\\n' +
      '      -p 5434:5432 pgvector/pgvector:pg18\n' +
      "    DATABASE_URL='postgres://postgres:postgres@localhost:5434/mneia' pnpm db:migrate\n" +
      "    DATABASE_URL='postgres://postgres:postgres@localhost:5434/mneia' pnpm latency:budget\n" +
      '  Never point it at production or at a Neon branch - MNE-226 is why.\n',
  );
  process.exit(2);
}

const BENCH_ROLE = 'mneia_bench';
const EMBEDDING_MODEL = 'openai:text-embedding-3-small';

const WORKSPACE = 'b0000000-0000-4000-8000-000000000001';
const TEAM = 'b0000000-0000-4000-8000-000000000002';
const PROJECT = 'b0000000-0000-4000-8000-000000000003';

const ACTOR_COUNT = 6;
const SESSION_COUNT = 260;
const TOPIC_COUNT = 40;

const actorId = (index) => `a0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const sessionId = (index) => `50000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
const itemId = (index) => `c0000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

const LEAD_ACTOR = actorId(0);

const mulberry32 = (state) => {
  let value = state >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, weighted) => {
  const roll = random();
  let cumulative = 0;
  for (const [value, share] of weighted) {
    cumulative += share;
    if (roll < cumulative) {
      return value;
    }
  }
  return weighted[weighted.length - 1][0];
};

const KIND_MIX = [
  ['fact', 0.4],
  ['decision', 0.25],
  ['constraint', 0.15],
  ['open_question', 0.12],
  ['artifact_ref', 0.08],
];

const STATUS_MIX = [
  ['active', 0.78],
  ['superseded', 0.17],
  ['disputed', 0.02],
  ['retired', 0.03],
];

const ACCESS_MIX = [
  ['project', 0.72],
  ['team', 0.16],
  ['workspace', 0.09],
  ['private', 0.03],
];

const SUBJECTS = [
  'the store adapter',
  'workspace isolation',
  'the rehydration budget',
  'the extraction prompt',
  'the telemetry spine',
  'the migration runner',
  'the review queue',
  'the device flow',
  'rate limiting',
  'the handoff artifact',
  'the token counter',
  'the supersede arbiter',
  'the embedding backfill',
  'the deploy gate',
  'the waitlist campaign',
  'the billing webhook',
];

const VERBS = [
  'settles how',
  'constrains',
  'reopens',
  'documents why',
  'measures',
  'retires the workaround in',
  'blocks a regression in',
];

const BODY_FRAGMENTS = [
  'The measurement that decided it, and the run it came from, so nobody re-argues it from memory.',
  'Rejected alternatives, each with the reason it lost, because the next agent will propose them again.',
  'Two failure modes were observed before this landed, and both are reproducible from the fixture.',
  'This holds only while the deployed code tolerates it; the follow-up migration is what makes it permanent.',
  'Provenance points at the session that produced it rather than at the commit, which lags by hours.',
];

const topicVector = (topic) => {
  const random = mulberry32(seed + topic * 7919);
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => random() * 2 - 1);
};

const TOPICS = Array.from({ length: TOPIC_COUNT }, (_, index) => topicVector(index));

const embeddingLiteralFor = (topic, jitterSeed) => {
  const centroid = TOPICS[topic];
  const random = mulberry32(jitterSeed);
  const parts = new Array(EMBEDDING_DIMENSIONS);
  let norm = 0;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    const value = centroid[index] + (random() * 2 - 1) * 0.35;
    parts[index] = value;
    norm += value * value;
  }
  const scale = 1 / Math.sqrt(norm);
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    parts[index] = (parts[index] * scale).toFixed(6);
  }
  return `[${parts.join(',')}]`;
};

const taskVectorFor = (run) => {
  const literal = embeddingLiteralFor(run % TOPIC_COUNT, seed + 999983 + run);
  return literal
    .slice(1, -1)
    .split(',')
    .map((value) => Number(value));
};

const percentile = (sorted, fraction) => {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(sorted.length * fraction) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
};

const summarize = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length),
  };
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

class BenchSession {
  constructor(client) {
    this.client = client;
  }

  async execute(sql, params = []) {
    const result =
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows };
  }

  async release() {
    this.client.release();
  }

  async discard() {
    this.client.release(true);
  }
}

class BenchConnectionSource {
  constructor(pool) {
    this.pool = pool;
  }

  async acquire() {
    const client = await this.pool.connect();
    await client.query(`SET ROLE ${BENCH_ROLE}`);
    return new BenchSession(client);
  }
}

const pool = new Pool({ connectionString, max: 4 });

const withPrivileged = async (run) => {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
};

async function ensureBenchRole() {
  await withPrivileged(async (client) => {
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${BENCH_ROLE}') THEN
           CREATE ROLE ${BENCH_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
         END IF;
       END $$`,
    );
    await client.query(`GRANT ${BENCH_ROLE} TO CURRENT_USER`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${BENCH_ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${BENCH_ROLE}`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${BENCH_ROLE}`);
  });
}

const chunked = (total, size) => {
  const ranges = [];
  for (let start = 0; start < total; start += size) {
    ranges.push([start, Math.min(total, start + size)]);
  }
  return ranges;
};

const insertActors = async (client) => {
  for (let index = 0; index < ACTOR_COUNT; index += 1) {
    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
      [
        actorId(index),
        WORKSPACE,
        index < 2 ? 'human' : 'agent',
        index < 2 ? `engineer ${index}` : `agent ${index}`,
      ],
    );
  }
};

const insertTeamMembers = async (client) => {
  for (let index = 0; index < ACTOR_COUNT; index += 1) {
    await client.query(
      'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
      [WORKSPACE, TEAM, actorId(index), index === 0 ? 'lead' : 'member'],
    );
  }
};

const insertSessions = async (client) => {
  const values = [];
  const params = [];
  for (let index = 0; index < SESSION_COUNT; index += 1) {
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, now() - ($${base + 5} || ' hours')::interval)`,
    );
    params.push(
      sessionId(index),
      WORKSPACE,
      PROJECT,
      actorId(index % ACTOR_COUNT),
      String(Math.floor((index / SESSION_COUNT) * 180 * 24)),
    );
  }
  await client.query(
    `INSERT INTO session (id, workspace_id, project_id, actor_id, started_at)
       VALUES ${values.join(', ')}`,
    params,
  );
};

async function seedScaffold() {
  await withPrivileged(async (client) => {
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE]);
    for (const table of ['context_item', 'session', 'project', 'team_member', 'team', 'actor']) {
      await client.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [WORKSPACE]);
    }
    await client.query('DELETE FROM workspace WHERE id = $1', [WORKSPACE]);
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      WORKSPACE,
      'rehydrate-budget-bench',
    ]);

    await insertActors(client);

    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [TEAM, WORKSPACE, 'bench-platform'],
    );
    await insertTeamMembers(client);
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
      [PROJECT, WORKSPACE, TEAM, 'bench-platform'],
    );

    await insertSessions(client);
  });
}

async function seedCorpus() {
  const startedAt = performance.now();

  await seedScaffold();

  const random = mulberry32(seed);
  const plan = [];
  for (let index = 0; index < items; index += 1) {
    const kind = pick(random, KIND_MIX);
    const status = pick(random, STATUS_MIX);
    plan.push({
      index,
      kind,
      status,
      accessScope: pick(random, ACCESS_MIX),
      loadBearing: kind === 'constraint' ? random() < 0.35 : false,
      humanConfirmed: random() < 0.3,
      confidence: Number((0.4 + random() * 0.6).toFixed(3)),
      ageMinutes: Math.floor(random() * 180 * 24 * 60),
      actor: actorId(Math.floor(random() * ACTOR_COUNT)),
      session: sessionId(Math.floor(random() * SESSION_COUNT)),
      topic: Math.floor(random() * TOPIC_COUNT),
      subject: SUBJECTS[Math.floor(random() * SUBJECTS.length)],
      verb: VERBS[Math.floor(random() * VERBS.length)],
      bodyLines: 1 + Math.floor(random() * 4),
      bodyOffset: Math.floor(random() * BODY_FRAGMENTS.length),
    });
  }

  await withPrivileged(async (client) => {
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE]);

    for (const [start, end] of chunked(items, 250)) {
      const values = [];
      const params = [];
      for (let index = start; index < end; index += 1) {
        const row = plan[index];
        const base = params.length;
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, ` +
            `$${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, ` +
            `now() - ($${base + 13} || ' minutes')::interval, now() - ($${base + 13} || ' minutes')::interval)`,
        );
        const body = Array.from(
          { length: row.bodyLines },
          (_unused, line) => BODY_FRAGMENTS[(row.bodyOffset + line) % BODY_FRAGMENTS.length],
        ).join(' ');
        params.push(
          itemId(index),
          WORKSPACE,
          PROJECT,
          row.kind,
          `${row.subject} — item ${index} ${row.verb} ${row.subject} for build ${index % 97}`,
          body,
          row.status,
          row.loadBearing,
          row.humanConfirmed,
          row.confidence,
          row.accessScope,
          row.actor,
          String(row.ageMinutes),
        );
      }
      await client.query(
        `INSERT INTO context_item
           (id, workspace_id, project_id, kind, title, body, status, load_bearing,
            human_confirmed, confidence, access_scope, asserted_by, asserted_at, valid_from)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    for (const [start, end] of chunked(items, 200)) {
      const values = [];
      const params = [];
      for (let index = start; index < end; index += 1) {
        const row = plan[index];
        const base = params.length;
        values.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`,
        );
        params.push(
          WORKSPACE,
          itemId(index),
          EMBEDDING_MODEL,
          EMBEDDING_DIMENSIONS,
          embeddingLiteralFor(row.topic, seed + index * 31),
        );
      }
      await client.query(
        `INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    await client.query('ANALYZE context_item');
    await client.query('ANALYZE context_item_embedding');
    await client.query('CHECKPOINT');
  });

  const counts = await withPrivileged(async (client) => {
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE]);
    const { rows } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'superseded')::int AS superseded,
              count(*) FILTER (WHERE load_bearing AND status = 'active')::int AS mandatory
         FROM context_item
        WHERE project_id = $1`,
      [PROJECT],
    );
    return rows[0];
  });

  return { ...counts, seedMs: performance.now() - startedAt };
}

async function measure() {
  const adapter = new PostgresStoreAdapter(new BenchConnectionSource(pool));
  const scope = { workspaceId: WORKSPACE, actorId: LEAD_ACTOR };

  let sliceItems = 0;
  let mandatoryItems = 0;
  let droppedItems = 0;
  let tokensUsed = 0;

  const once = async (run) => {
    const taskEmbedding = taskVectorFor(run);
    const task = `Continue run ${run} of the rehydration budget work on the store adapter`;
    const startedAt = performance.now();
    const assembled = await adapter.withScope(scope, async (scoped) => {
      const project = await scoped.getProject(PROJECT);
      if (project === null) {
        throw new Error(`the benchmark project ${PROJECT} was not readable inside the scope`);
      }
      return assembleSlice({
        store: scoped,
        project,
        task,
        tokenBudget,
        now: new Date(),
        taskEmbedding,
        embeddingModel: EMBEDDING_MODEL,
      });
    });
    const elapsed = performance.now() - startedAt;

    if (assembled.slice.items.length === 0) {
      throw new Error(
        'the slice came back empty, so this run timed nothing; the corpus or the scope is wrong',
      );
    }
    const present = new Set(assembled.slice.items.map((entry) => entry.item.id));
    for (const mandatoryId of assembled.mandatoryItemIds) {
      if (!present.has(mandatoryId)) {
        throw new Error(
          `standing rule 2: load-bearing constraint ${mandatoryId} was dropped from the slice`,
        );
      }
    }

    sliceItems = assembled.slice.items.length;
    mandatoryItems = assembled.mandatoryItemIds.length;
    droppedItems = assembled.droppedItemIds.length;
    tokensUsed = assembled.slice.tokensUsed;
    return elapsed;
  };

  for (let run = 0; run < warmup; run += 1) {
    await once(run);
  }

  const perBatch = [];
  const pooled = [];
  let sequence = warmup;

  for (let batch = 0; batch < batches; batch += 1) {
    const durations = [];
    for (let run = 0; run < runs; run += 1) {
      durations.push(await once(sequence));
      sequence += 1;
    }
    pooled.push(...durations);
    perBatch.push(summarize(durations));
  }

  return {
    perBatch,
    pooled: summarize(pooled),
    slice: { items: sliceItems, mandatory: mandatoryItems, dropped: droppedItems, tokensUsed },
  };
}

const ms = (value) => `${value.toFixed(1)}ms`;

function render(report) {
  const lines = [];
  const w = (line = '') => lines.push(line);

  w('mneia_rehydrate p95 budget — vision.md §12.1, standing rule 4');
  w();
  w('What is timed: one withScope transaction end to end — the RLS posture check, the project');
  w('lookup, selectRehydrationCandidates against pgvector, scoring, quota packing, and the');
  w('markdown render. No HTTP, and no call out to the embedding API for the task vector: the');
  w('first is measured by pnpm latency:rehydrate, the second is a third-party latency this');
  w('gate cannot hold. So this is the half of the budget the repo can actually defend.');
  w();
  w(
    `Corpus: ${report.corpus.total} items (${report.corpus.active} active, ${report.corpus.superseded} superseded, ` +
      `${report.corpus.mandatory} load-bearing constraints), ${EMBEDDING_DIMENSIONS}-d embeddings on every one,`,
  );
  w(
    `        ${SESSION_COUNT} sessions, ${ACTOR_COUNT} actors, ${TOPIC_COUNT} embedding topics, seeded from seed=${report.seed} in ${(report.corpus.seedMs / 1000).toFixed(1)}s.`,
  );
  w(`        Run pnpm latency:budget --explain for where ${SIX_MONTH_ITEM_COUNT} comes from.`);
  w(
    `Slice:  ${report.slice.items} items admitted, ${report.slice.mandatory} of them mandatory, ${report.slice.dropped} dropped;`,
  );
  w(
    `        ${report.slice.tokensUsed} tokens used against a ${tokenBudget}-token budget${
      report.slice.tokensUsed > tokenBudget
        ? ` — OVER by ${report.slice.tokensUsed - tokenBudget}, see the mandatory count above`
        : ''
    }.`,
  );
  w();
  w(
    `Samples: ${batches} batches of ${runs} after ${warmup} warm-up runs (${report.pooled.samples} measured).`,
  );
  w(
    `         Per-batch p99 is only the top sample until runs reaches 100, so read p99 from the pooled row.`,
  );
  w();
  w('            p50        p95        p99        max        mean');
  for (const [index, batch] of report.perBatch.entries()) {
    w(
      `  batch ${index + 1}  ${ms(batch.p50).padEnd(10)} ${ms(batch.p95).padEnd(10)} ` +
        `${ms(batch.p99).padEnd(10)} ${ms(batch.max).padEnd(10)} ${ms(batch.mean)}`,
    );
  }
  w(
    `  pooled   ${ms(report.pooled.p50).padEnd(10)} ${ms(report.pooled.p95).padEnd(10)} ` +
      `${ms(report.pooled.p99).padEnd(10)} ${ms(report.pooled.max).padEnd(10)} ${ms(report.pooled.mean)}`,
  );
  w();
  w('The gate');
  w(`  budget                 ${ms(report.budgetMs)} p95`);
  w(`  warn at                ${ms(report.warnMs)} p95`);
  w(`  gate statistic         ${ms(report.gateP95)}  (median of the ${batches} batch p95s)`);
  w(`  batch p95 spread       ${ms(report.spreadMs)}  — the runner's noise floor`);
  w();
  w('  The gate is the MEDIAN of the batch p95s, not the best of them. Best-of-N is biased low');
  w('  by construction: every extra batch can only lower the number, so the gate loosens each');
  w('  time someone adds a batch to quiet it down. A median needs half the batches to be slow,');
  w('  which noise does not manage and a real regression does.');
  w(
    `  What it costs: a regression smaller than the ${ms(report.spreadMs)} spread between batches is invisible`,
  );
  w('  to this gate. It catches a step change in the ranker or the query, not a 5% drift. If');
  w('  the spread ever approaches the headroom, raise --batches rather than the budget.');
  w();

  if (report.gateP95 > report.budgetMs) {
    w(
      `FAIL  p95 ${ms(report.gateP95)} is over the ${ms(report.budgetMs)} budget on a ${report.corpus.total}-item corpus.`,
    );
    w('      vision.md §12.1: "if it is slow, nobody calls it and the product fails." This is the');
    w(
      '      store and ranking half only, so the end-to-end number is worse — docs/REHYDRATE-LATENCY.md',
    );
    w('      has the network half. Do not widen the budget or shrink the corpus to clear this.');
  } else if (report.gateP95 > report.warnMs) {
    w(
      `WARN  p95 ${ms(report.gateP95)} is inside the ${ms(report.budgetMs)} budget but past the ${ms(report.warnMs)} warning line.`,
    );
    w(
      `      ${ms(report.budgetMs - report.gateP95)} of headroom left. The build is green; the trend is not.`,
    );
  } else {
    w(
      `PASS  p95 ${ms(report.gateP95)} against a ${ms(report.budgetMs)} budget — ${ms(report.budgetMs - report.gateP95)} of headroom on ${report.corpus.total} items.`,
    );
  }

  return lines.join('\n');
}

let exitCode = 0;

try {
  await ensureBenchRole();

  const corpus = skipSeed
    ? await withPrivileged(async (client) => {
        await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE]);
        const { rows } = await client.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE status = 'active')::int AS active,
                  count(*) FILTER (WHERE status = 'superseded')::int AS superseded,
                  count(*) FILTER (WHERE load_bearing AND status = 'active')::int AS mandatory
             FROM context_item
            WHERE project_id = $1`,
          [PROJECT],
        );
        return { ...rows[0], seedMs: 0 };
      })
    : await seedCorpus();

  if (corpus.total === 0) {
    throw new Error(
      'the benchmark corpus is empty; drop --no-seed so the run seeds it before measuring',
    );
  }

  const measured = await measure();
  const batchP95s = measured.perBatch.map((batch) => batch.p95);
  const gateP95 = median(batchP95s);
  const warnMs = budgetMs * WARN_FRACTION;

  const report = {
    budgetMs,
    warnMs,
    gateP95,
    spreadMs: Math.max(...batchP95s) - Math.min(...batchP95s),
    seed,
    tokenBudget,
    corpus,
    slice: measured.slice,
    perBatch: measured.perBatch,
    pooled: measured.pooled,
    verdict: gateP95 > budgetMs ? 'fail' : gateP95 > warnMs ? 'warn' : 'pass',
  };

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
  exitCode = report.verdict === 'fail' ? 1 : 0;
} catch (error) {
  process.stderr.write(
    `rehydrate-budget: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  exitCode = 2;
} finally {
  await pool.end();
}

process.exit(exitCode);
