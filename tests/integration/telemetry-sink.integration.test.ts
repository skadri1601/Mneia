import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import type {
  PostgresConnectionSource,
  PostgresSession,
  SqlResult,
  SqlValue,
  TelemetryEvent,
} from '../../packages/core/src/index.js';
import {
  createPostgresSink,
  createTelemetryEmitter,
  migrate,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_A = '11111111-1111-4111-8111-1111111111e1';
const WS_B = '11111111-1111-4111-8111-1111111111e2';
const PROJECT_A = '44444444-4444-4444-8444-4444444444e1';
const ACTOR_A = '22222222-2222-4222-8222-2222222222e1';
const SESSION_A = '77777777-7777-4777-8777-7777777777e1';
const ITEM_A = '55555555-5555-4555-8555-5555555555e1';
const CHECKPOINT_A = '66666666-6666-4666-8666-6666666666e1';

const OCCURRED_AT = new Date('2026-08-09T13:37:42.500Z');

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

async function withSchema(
  run: (source: PostgresConnectionSource, setup: Client) => Promise<void>,
): Promise<void> {
  const schema = `mne268_${process.pid}_${++schemaCounter}`;
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

    await run(source, setup);
  } finally {
    await source.close();
    await setup.query('RESET ROLE');
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

const sliceShown = (workspaceId: string): TelemetryEvent =>
  ({
    name: 'rehydration.slice_shown',
    workspaceId,
    projectId: PROJECT_A,
    actorId: ACTOR_A,
    sessionId: SESSION_A,
    occurredAt: OCCURRED_AT,
    sliceId: '88888888-8888-4888-8888-8888888888e1',
    itemIds: [ITEM_A],
    tokenBudget: 4000,
    tokensUsed: 812,
    durationMs: 42,
  }) as TelemetryEvent;

interface StoredRow {
  readonly workspace_id: string;
  readonly project_id: string | null;
  readonly actor_id: string | null;
  readonly session_id: string | null;
  readonly name: string;
  readonly occurred_at: Date;
  readonly payload: Record<string, unknown>;
}

const SELECT_ALL =
  'SELECT workspace_id, project_id, actor_id, session_id, name, occurred_at, payload FROM telemetry_event ORDER BY name';

const readAs = async (
  source: PostgresConnectionSource,
  workspaceId: string,
): Promise<StoredRow[]> => {
  const session = await source.acquire();
  try {
    await session.execute('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    const result = await session.execute<StoredRow>(SELECT_ALL);
    return [...result.rows];
  } finally {
    await session.release();
  }
};

const countAsSuperuser = async (setup: Client): Promise<number> => {
  const result = await setup.query('SELECT count(*)::int AS total FROM telemetry_event');
  return Number((result.rows[0] as { total: number }).total);
};

describe.skipIf(connectionString === undefined)('telemetry_event postgres sink', () => {
  it('lands a §17 event as a real row the partitioned table accepts', async () => {
    await withSchema(async (source, setup) => {
      const sink = createPostgresSink({ source, flushIntervalMs: 0 });
      const emitter = createTelemetryEmitter({ sinks: [sink], enabled: true });

      await emitter.emit(sliceShown(WS_A));
      await emitter.flush();

      const rows = await readAs(source, WS_A);
      expect(rows).toHaveLength(1);
      expect(await countAsSuperuser(setup)).toBe(1);

      const [row] = rows;
      expect(row?.workspace_id).toBe(WS_A);
      expect(row?.project_id).toBe(PROJECT_A);
      expect(row?.actor_id).toBe(ACTOR_A);
      expect(row?.session_id).toBe(SESSION_A);
      expect(row?.name).toBe('rehydration.slice_shown');
      expect(row?.occurred_at.toISOString()).toBe(OCCURRED_AT.toISOString());
      expect(row?.payload).toEqual({
        sliceId: '88888888-8888-4888-8888-8888888888e1',
        itemIds: [ITEM_A],
        tokenBudget: 4000,
        tokensUsed: 812,
        durationMs: 42,
      });
    });
  });

  it('routes the row into a real partition rather than leaving the table empty', async () => {
    await withSchema(async (source, setup) => {
      const sink = createPostgresSink({ source, flushIntervalMs: 0 });

      await sink.write(sliceShown(WS_A));
      await sink.flush();

      await setup.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);
      const result = await setup.query(
        'SELECT tableoid::regclass AS partition FROM telemetry_event',
      );
      expect(result.rows).toHaveLength(1);
      expect(String(result.rows[0]?.partition)).toContain('telemetry_event');
    });
  });

  it('keeps one workspace from reading another workspace telemetry', async () => {
    await withSchema(async (source, setup) => {
      const sink = createPostgresSink({ source, flushIntervalMs: 0 });

      await sink.write(sliceShown(WS_A));
      await sink.write(sliceShown(WS_B));
      await sink.flush();

      expect(await countAsSuperuser(setup)).toBe(2);

      const seenByA = await readAs(source, WS_A);
      expect(seenByA).toHaveLength(1);
      expect(seenByA[0]?.workspace_id).toBe(WS_A);

      const seenByB = await readAs(source, WS_B);
      expect(seenByB).toHaveLength(1);
      expect(seenByB[0]?.workspace_id).toBe(WS_B);
    });
  });

  it('stores no item body, because redaction runs before the row is built', async () => {
    await withSchema(async (source, setup) => {
      const sink = createPostgresSink({ source, flushIntervalMs: 0 });
      const emitter = createTelemetryEmitter({ sinks: [sink], enabled: true });

      await emitter.emit({
        name: 'checkpoint.item_extracted',
        workspaceId: WS_A,
        projectId: PROJECT_A,
        actorId: ACTOR_A,
        sessionId: null,
        occurredAt: OCCURRED_AT,
        checkpointId: CHECKPOINT_A,
        itemId: ITEM_A,
        kind: 'decision',
        confidence: 0.91,
        loadBearing: true,
        trigger: 'manual',
        body: 'we ruled out Kafka because the ops burden is not worth it',
        rationale: 'the human confirmed it at checkpoint',
      } as unknown as TelemetryEvent);
      await emitter.flush();

      const rows = await readAs(source, WS_A);
      expect(rows).toHaveLength(1);

      const serialised = JSON.stringify(rows[0]?.payload).toLowerCase();
      expect(serialised).not.toContain('kafka');
      expect(serialised).not.toContain('rationale');
      expect(serialised).not.toContain('"body"');
      expect(rows[0]?.payload).toEqual({
        checkpointId: CHECKPOINT_A,
        itemId: ITEM_A,
        kind: 'decision',
        confidence: 0.91,
        loadBearing: true,
        trigger: 'manual',
      });
    });
  });

  it('writes a batch spanning workspaces without losing any of it', async () => {
    await withSchema(async (source, setup) => {
      const sink = createPostgresSink({ source, flushIntervalMs: 0 });

      for (let index = 0; index < 5; index += 1) {
        await sink.write(sliceShown(WS_A));
        await sink.write(sliceShown(WS_B));
      }
      await sink.flush();

      expect(await countAsSuperuser(setup)).toBe(10);
      expect(await readAs(source, WS_A)).toHaveLength(5);
      expect(await readAs(source, WS_B)).toHaveLength(5);
    });
  });
});
