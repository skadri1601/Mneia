import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import {
  DEFAULT_RATE_LIMIT_CONFIG,
  evaluateRateLimit,
  RATE_LIMIT_RETENTION_SECONDS,
  type RateLimitConfig,
  type RequestCost,
  windowsFor,
} from '../../apps/web/src/server/rate-limit.js';
import { PostgresRateLimitStore } from '../../apps/web/src/server/store/postgres-rate-limit-store.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  SqlResult,
  SqlValue,
} from '../../packages/core/src/index.js';
import { migrate, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_A = '11111111-1111-4111-8111-1111111111c1';
const WS_B = '11111111-1111-4111-8111-1111111111c2';
const TOKEN_A = '66666666-6666-4666-8666-666666666601';
const TOKEN_B = '66666666-6666-4666-8666-666666666602';

const NOW = new Date('2026-08-07T13:37:42.500Z');

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class SchemaSession implements PostgresSession {
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

class SchemaConnectionSource implements PostgresConnectionSource {
  private readonly clients: Client[] = [];

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${APP_ROLE}`);
    this.clients.push(client);
    return new SchemaSession(client);
  }

  async close(): Promise<void> {
    const open = this.clients.splice(0, this.clients.length);
    for (const client of open) {
      await client.end();
    }
  }
}

let schemaCounter = 0;

async function withStore(
  run: (store: PostgresRateLimitStore, client: Client) => Promise<void>,
): Promise<void> {
  const schema = `mne173_${process.pid}_${++schemaCounter}`;
  const setup = await connect();
  const source = new SchemaConnectionSource(schema);

  try {
    await ensureAppRole(setup);
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'integration' });
    await grantSchemaToAppRole(setup, schema);

    for (const [id, slug] of [
      [WS_A, 'acme'],
      [WS_B, 'globex'],
    ]) {
      await setup.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
      await setup.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
        id,
        slug,
        slug,
      ]);
    }

    await run(new PostgresRateLimitStore(source), setup);
  } finally {
    await source.close();
    await setup.query('RESET ROLE');
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

interface AttemptInput {
  readonly store: PostgresRateLimitStore;
  readonly cost: RequestCost;
  readonly tokenId: string;
  readonly workspaceId: string;
  readonly now?: Date;
  readonly config?: RateLimitConfig;
}

const attempt = async ({
  store,
  cost,
  tokenId,
  workspaceId,
  now = NOW,
  config = DEFAULT_RATE_LIMIT_CONFIG,
}: AttemptInput) => {
  const windows = windowsFor({ cost, tokenId, now, config });
  const counters = {
    workspaceId,
    windows,
    discardBefore: new Date(now.getTime() - RATE_LIMIT_RETENTION_SECONDS * 1000),
  };
  const counts = await store.bump(counters);
  const decision = evaluateRateLimit({ windows, counts, now });
  // Mirrors serve.ts: a refused request gives its slot back, so the counter counts what
  // was served rather than what was attempted.
  if (!decision.allowed) {
    await store.release(counters);
  }
  return decision;
};

describe.skipIf(connectionString === undefined)('rate limit counters', () => {
  it('counts every attempt in a window and resets in the next one', async () => {
    await withStore(async (store) => {
      const first = await attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A });
      const second = await attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);

      const nextMinute = new Date(NOW.getTime() + 60_000);
      const windows = windowsFor({
        cost: 'read',
        tokenId: TOKEN_A,
        workspaceId: WS_A,
        now: nextMinute,
        config: DEFAULT_RATE_LIMIT_CONFIG,
      });
      const counts = await store.bump({
        workspaceId: WS_A,
        windows,
        discardBefore: new Date(0),
      });

      expect(counts.get('requests')).toBe(1);
    });
  }, 30_000);

  it('binds under concurrent load, refusing exactly the attempts past the limit', async () => {
    await withStore(async (store) => {
      const config: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, requestsPerMinute: 25 };
      const attempts = 40;

      const decisions = await Promise.all(
        Array.from({ length: attempts }, () =>
          attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A, config }),
        ),
      );

      const allowed = decisions.filter((decision) => decision.allowed).length;
      const refused = decisions.length - allowed;

      expect(allowed).toBe(config.requestsPerMinute);
      expect(refused).toBe(attempts - config.requestsPerMinute);
      expect(decisions.find((decision) => !decision.allowed)?.retryAfterSeconds).toBeGreaterThan(0);
    });
  }, 60_000);

  // MNE-103 removed the checkpoints_hourly and checkpoints_daily buckets. What a checkpoint
  // may consume is decided by the three dials in quota.ts against the plan's monthly
  // allowance, because a checkpoint count is not a unit of cost - 17 to 1,092 turns across
  // 116 real ones. The two tests that pinned those ceilings were removed with them.
  it('gives the slot back when a request is refused, so a refusal does not cost the next caller', async () => {
    await withStore(async (store) => {
      const config: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, requestsPerMinute: 1 };

      await attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A, config });
      const refused = await attempt({
        store,
        cost: 'read',
        tokenId: TOKEN_A,
        workspaceId: WS_A,
        config,
      });
      expect(refused.allowed).toBe(false);

      // Before the release, this second refusal observed 3 rather than 2: the refused
      // request above had already been counted, so every refusal pushed the window further
      // out. The observed count must stay pinned at the limit plus one.
      const again = await attempt({
        store,
        cost: 'read',
        tokenId: TOKEN_A,
        workspaceId: WS_A,
        config,
      });
      expect(again.allowed).toBe(false);
      expect(again.message).toContain('has made 2 requests');
    });
  }, 30_000);

  it('counts each workspace separately', async () => {
    await withStore(async (store) => {
      const config: RateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, requestsPerMinute: 1 };

      const first = await attempt({
        store,
        cost: 'read',
        tokenId: TOKEN_A,
        workspaceId: WS_A,
        config,
      });
      const refused = await attempt({
        store,
        cost: 'read',
        tokenId: TOKEN_A,
        workspaceId: WS_A,
        config,
      });
      const other = await attempt({
        store,
        cost: 'read',
        tokenId: TOKEN_B,
        workspaceId: WS_B,
        config,
      });

      expect(first.allowed).toBe(true);
      expect(refused.allowed).toBe(false);
      expect(other.allowed).toBe(true);
    });
  }, 30_000);

  it('sweeps windows older than the retention horizon', async () => {
    await withStore(async (store, client) => {
      const old = new Date(NOW.getTime() - RATE_LIMIT_RETENTION_SECONDS * 1000 - 60_000);

      await attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A, now: old });
      await attempt({ store, cost: 'read', tokenId: TOKEN_A, workspaceId: WS_A });

      await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);
      const remaining = await client.query(
        'SELECT window_start FROM rate_limit_counter WHERE workspace_id = $1',
        [WS_A],
      );

      expect(remaining.rows).toHaveLength(1);
    });
  }, 30_000);
});
