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
  const windows = windowsFor({ cost, tokenId, workspaceId, now, config });
  const counts = await store.bump({
    workspaceId,
    windows,
    discardBefore: new Date(now.getTime() - RATE_LIMIT_RETENTION_SECONDS * 1000),
  });
  return evaluateRateLimit({ windows, counts, now });
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

  it('caps checkpoints harder than reads on the same token', async () => {
    await withStore(async (store) => {
      const config: RateLimitConfig = {
        ...DEFAULT_RATE_LIMIT_CONFIG,
        requestsPerMinute: 100,
        checkpointsPerHour: 3,
      };

      const decisions = [];
      for (let index = 0; index < 5; index += 1) {
        decisions.push(
          await attempt({ store, cost: 'checkpoint', tokenId: TOKEN_A, workspaceId: WS_A, config }),
        );
      }

      expect(decisions.filter((decision) => decision.allowed)).toHaveLength(3);
      expect(decisions[3]?.message).toContain('MNEIA_RATE_LIMIT_CHECKPOINTS_PER_HOUR');
    });
  }, 30_000);

  it('holds the daily ceiling across tokens, so issuing a new token does not reset it', async () => {
    await withStore(async (store) => {
      const config: RateLimitConfig = {
        ...DEFAULT_RATE_LIMIT_CONFIG,
        checkpointsPerDay: 2,
      };

      await attempt({ store, cost: 'checkpoint', tokenId: TOKEN_A, workspaceId: WS_A, config });
      await attempt({ store, cost: 'checkpoint', tokenId: TOKEN_A, workspaceId: WS_A, config });
      const fresh = await attempt({
        store,
        cost: 'checkpoint',
        tokenId: TOKEN_B,
        workspaceId: WS_A,
        config,
      });

      expect(fresh.allowed).toBe(false);
      expect(fresh.message).toContain('hard per-account ceiling');
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
