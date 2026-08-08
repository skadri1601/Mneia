import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SqlResult, SqlValue } from '../../packages/core/src/index.js';
import {
  assembleSlice,
  EMBEDDING_DIMENSIONS,
  migrate,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  WorkspaceScope,
} from '../../packages/core/src/store/adapter/index.js';
import { PostgresStoreAdapter } from '../../packages/core/src/store/adapter/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

export const P95_BUDGET_MS = 300;

const ITEM_COUNT = 2000;
const LOAD_BEARING_CONSTRAINTS = 40;
const SUPERSEDED_ITEMS = 60;
const WARMUP_RUNS = 5;
const MEASURED_RUNS = 30;
const TOKEN_BUDGET = 4000;

const WS = '5eeeeeee-0000-4000-8000-000000000001';
const ACTOR = '5eeeeeee-0000-4000-8000-000000000002';
const TEAM = '5eeeeeee-0000-4000-8000-000000000003';
const PROJECT = '5eeeeeee-0000-4000-8000-000000000004';

const SCOPE: WorkspaceScope = { workspaceId: WS, actorId: ACTOR };

const KINDS = ['decision', 'constraint', 'open_question', 'fact', 'artifact_ref'] as const;

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
] as const;

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class BenchSession implements PostgresSession {
  constructor(private readonly client: Client) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    const result =
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows as TRow[] };
  }

  async release(): Promise<void> {}

  async discard(): Promise<void> {
    await this.client.end();
  }
}

class BenchConnectionSource implements PostgresConnectionSource {
  private readonly clients: Client[] = [];

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${APP_ROLE}`);
    this.clients.push(client);
    return new BenchSession(client);
  }

  async close(): Promise<void> {
    const open = this.clients.splice(0, this.clients.length);
    for (const client of open) {
      await client.end();
    }
  }
}

const vectorLiteral = (seed: number): string => {
  const values = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    Number(Math.sin(seed + index * 0.001).toFixed(6)),
  );
  return `[${values.join(',')}]`;
};

const titleFor = (index: number): string => {
  const subject = SUBJECTS[index % SUBJECTS.length];
  return `Item ${index} settles how ${subject} behaves under load in build ${index % 97}`;
};

const percentile = (sorted: readonly number[], fraction: number): number => {
  const rank = Math.ceil(sorted.length * fraction) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)] ?? 0;
};

async function seedCorpus(client: Client): Promise<void> {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS]);
  await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
    WS,
    'bench',
  ]);
  await client.query(
    'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
    [ACTOR, WS, 'human', 'bench lead'],
  );
  await client.query(
    'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
    [TEAM, WS, 'bench-eng'],
  );
  await client.query(
    'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
    [WS, TEAM, ACTOR, 'lead'],
  );
  await client.query(
    'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
    [PROJECT, WS, TEAM, 'bench-platform'],
  );

  for (let index = 0; index < ITEM_COUNT; index += 1) {
    const kind = KINDS[index % KINDS.length];
    const loadBearing = kind === 'constraint' && index < LOAD_BEARING_CONSTRAINTS * KINDS.length;
    const status = index >= ITEM_COUNT - SUPERSEDED_ITEMS ? 'superseded' : 'active';
    const inserted = await client.query(
      `INSERT INTO context_item
         (id, workspace_id, project_id, kind, title, body, status, load_bearing, human_confirmed,
          confidence, access_scope, asserted_by, asserted_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'project', $10,
               now() - ($11 || ' minutes')::interval)
       RETURNING id`,
      [
        WS,
        PROJECT,
        status === 'superseded' ? 'decision' : kind,
        titleFor(index),
        `Body for item ${index}. ${'Detail that a reader needs weeks later. '.repeat(4)}`,
        status,
        loadBearing,
        index % 7 === 0,
        0.5 + (index % 50) / 100,
        ACTOR,
        String(index),
      ],
    );
    const itemId = inserted.rows[0]?.id as string;

    await client.query(
      `INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
       VALUES ($1, $2, 'openai:text-embedding-3-small', $3, $4)`,
      [WS, itemId, EMBEDDING_DIMENSIONS, vectorLiteral(index)],
    );
  }
}

let adapter: PostgresStoreAdapter | null = null;
let source: BenchConnectionSource | null = null;
let setup: Client | null = null;
let schema = '';

describe.skipIf(connectionString === undefined)('rehydrate p95 budget', () => {
  beforeAll(async () => {
    schema = `mne73_${process.pid}`;
    setup = await connect();
    source = new BenchConnectionSource(schema);
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'benchmark' });
    await ensureAppRole(setup);
    await grantSchemaToAppRole(setup, schema);
    await seedCorpus(setup);
    adapter = new PostgresStoreAdapter(source);
  }, 600_000);

  afterAll(async () => {
    await source?.close();
    if (setup !== null) {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.end();
    }
  });

  it(`assembles a slice from ${ITEM_COUNT} items with p95 under ${P95_BUDGET_MS}ms`, async () => {
    const store = adapter;
    expect(store).not.toBeNull();
    if (store === null) {
      return;
    }

    const durations: number[] = [];

    const once = async (run: number): Promise<void> => {
      const startedAt = performance.now();
      await store.withScope(SCOPE, async (scoped) => {
        const project = await scoped.getProject(PROJECT);
        expect(project).not.toBeNull();
        if (project === null) {
          return;
        }
        const assembled = await assembleSlice({
          store: scoped,
          project,
          task: `Ship run ${run} of the rehydration budget work`,
          tokenBudget: TOKEN_BUDGET,
          now: new Date(),
          taskEmbedding: vectorLiteral(run)
            .slice(1, -1)
            .split(',')
            .map((value) => Number(value)),
          embeddingModel: 'openai:text-embedding-3-small',
        });
        expect(assembled.slice.items.length).toBeGreaterThan(0);
        expect(assembled.slice.tokensUsed).toBeLessThanOrEqual(TOKEN_BUDGET);
      });
      durations.push(performance.now() - startedAt);
    };

    for (let run = 0; run < WARMUP_RUNS; run += 1) {
      await once(run);
    }
    durations.length = 0;

    for (let run = 0; run < MEASURED_RUNS; run += 1) {
      await once(WARMUP_RUNS + run);
    }

    const sorted = [...durations].sort((left, right) => left - right);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const report = [
      `rehydrate over ${ITEM_COUNT} items, budget ${TOKEN_BUDGET} tokens, ${MEASURED_RUNS} runs:`,
      `  p50 ${p50.toFixed(1)}ms`,
      `  p95 ${p95.toFixed(1)}ms  (§12.1 budget ${P95_BUDGET_MS}ms)`,
      `  max ${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms`,
    ].join('\n');

    process.stdout.write(`${report}\n`);

    expect(
      p95,
      `${report}\n\nvision.md §12.1 puts mneia_rehydrate p95 under ${P95_BUDGET_MS}ms because a slow rehydrate is never called. This measures the store and ranking path only, with no network in it, so exceeding the budget here means the query or the ranker regressed.`,
    ).toBeLessThan(P95_BUDGET_MS);
  }, 600_000);

  it('keeps every load-bearing constraint in the slice regardless of budget pressure', async () => {
    const store = adapter;
    if (store === null) {
      return;
    }

    await store.withScope(SCOPE, async (scoped) => {
      const project = await scoped.getProject(PROJECT);
      if (project === null) {
        return;
      }

      const assembled = await assembleSlice({
        store: scoped,
        project,
        task: 'Confirm the guard holds against a corpus far larger than the budget',
        tokenBudget: 1200,
        now: new Date(),
      });

      const present = new Set(assembled.slice.items.map((item) => item.item.id));
      for (const mandatoryId of assembled.mandatoryItemIds) {
        expect(present.has(mandatoryId)).toBe(true);
      }
      expect(assembled.mandatoryItemIds.length).toBeGreaterThan(0);
    });
  }, 600_000);
});
