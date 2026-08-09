import { describe, expect, it } from 'vitest';
import type { PostgresConnectionSource, PostgresSession } from '../../store/adapter/postgres.js';
import type { SqlResult, SqlValue } from '../../store/driver.js';
import { WORKSPACE_SETTING } from '../../store/schema.js';
import { createTelemetryEmitter } from '../emitter.js';
import { REDACTED_KEYS } from '../redact.js';
import type { TelemetryEvent } from '../types.js';
import type { TelemetryPersistError } from './postgres.js';
import { createPostgresSink, TELEMETRY_EVENT_TABLE } from './postgres.js';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '55555555-5555-4555-8555-555555555555';
const CHECKPOINT_ID = '66666666-6666-4666-8666-666666666666';

const sliceShown = (workspaceId: string, sliceId: string): TelemetryEvent =>
  ({
    name: 'rehydration.slice_shown',
    workspaceId,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    sessionId: null,
    occurredAt: new Date('2026-08-09T12:00:00.000Z'),
    sliceId,
    itemIds: [ITEM_ID],
    tokenBudget: 4000,
    tokensUsed: 120,
    durationMs: 12,
  }) as TelemetryEvent;

interface Statement {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

interface Fake {
  readonly source: PostgresConnectionSource;
  readonly statements: Statement[];
  readonly acquired: () => number;
  readonly released: () => number;
}

const POSTURE_ROW = {
  role_name: 'mneia_app',
  session_role_name: 'mneia_app',
  role_is_superuser: false,
  role_bypasses_rls: false,
  granting_role: null,
  granting_is_superuser: false,
  granting_bypasses_rls: false,
};

function fakeSource(
  options: { readonly bypassesRls?: boolean; readonly failInsert?: boolean } = {},
): Fake {
  const statements: Statement[] = [];
  let acquired = 0;
  let released = 0;

  const session: PostgresSession = {
    execute<TRow>(sql: string, params: readonly SqlValue[] = []): Promise<SqlResult<TRow>> {
      statements.push({ sql, params });

      if (sql.includes('rolname')) {
        const row = { ...POSTURE_ROW, role_bypasses_rls: options.bypassesRls === true };
        return Promise.resolve({ rows: [row] as unknown as readonly TRow[] });
      }

      if (options.failInsert === true && sql.startsWith('INSERT INTO')) {
        return Promise.reject(new Error('relation "telemetry_event" does not exist'));
      }

      return Promise.resolve({ rows: [] });
    },
    release(): Promise<void> {
      released += 1;
      return Promise.resolve();
    },
    discard(): Promise<void> {
      released += 1;
      return Promise.resolve();
    },
  };

  return {
    statements,
    acquired: () => acquired,
    released: () => released,
    source: {
      acquire(): Promise<PostgresSession> {
        acquired += 1;
        return Promise.resolve(session);
      },
      close(): Promise<void> {
        return Promise.resolve();
      },
    },
  };
}

const insertsIn = (statements: readonly Statement[]): Statement[] =>
  statements.filter((statement) => statement.sql.startsWith('INSERT INTO'));

describe('createPostgresSink', () => {
  it('writes the event into telemetry_event with the context split into columns', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.flush();

    const [insert] = insertsIn(fake.statements);
    expect(insert).toBeDefined();
    expect(insert?.sql).toContain(TELEMETRY_EVENT_TABLE);

    const params = insert?.params ?? [];
    expect(params[1]).toBe(WORKSPACE_A);
    expect(params[2]).toBe(PROJECT_ID);
    expect(params[3]).toBe(ACTOR_ID);
    expect(params[4]).toBeNull();
    expect(params[5]).toBe('rehydration.slice_shown');
    expect(params[6]).toBeInstanceOf(Date);

    const payload: unknown = JSON.parse(String(params[7]));
    expect(payload).toEqual({
      sliceId: 'slice-1',
      itemIds: [ITEM_ID],
      tokenBudget: 4000,
      tokensUsed: 120,
      durationMs: 12,
    });
  });

  it('sets the workspace GUC so the row satisfies its own RLS policy', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.flush();

    const setConfig = fake.statements.find((statement) => statement.sql.includes('set_config'));
    expect(setConfig?.params).toEqual([WORKSPACE_SETTING, WORKSPACE_A]);

    const order = fake.statements.map((statement) =>
      statement.sql.startsWith('INSERT INTO') ? 'INSERT' : statement.sql.split(' ')[0],
    );
    expect(order.indexOf('SELECT')).toBeLessThan(order.indexOf('INSERT'));
    expect(order.indexOf('BEGIN')).toBeLessThan(order.indexOf('INSERT'));
    expect(order).toContain('COMMIT');
  });

  it('writes one transaction per workspace, never mixing tenants under one GUC', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-a1'));
    await sink.write(sliceShown(WORKSPACE_B, 'slice-b1'));
    await sink.write(sliceShown(WORKSPACE_A, 'slice-a2'));
    await sink.flush();

    const inserts = insertsIn(fake.statements);
    expect(inserts).toHaveLength(2);

    const gucs = fake.statements
      .filter((statement) => statement.sql.includes('set_config'))
      .map((statement) => statement.params[1]);
    expect(new Set(gucs)).toEqual(new Set([WORKSPACE_A, WORKSPACE_B]));

    for (const insert of inserts) {
      const workspaces = new Set(
        insert.params.filter((_, index) => index % 8 === 1).map((value) => String(value)),
      );
      expect(workspaces.size).toBe(1);
    }
  });

  it('refuses to write on a connection that bypasses row-level security', async () => {
    const fake = fakeSource({ bypassesRls: true });
    const failures: TelemetryPersistError[] = [];
    const sink = createPostgresSink({
      source: fake.source,
      flushIntervalMs: 0,
      onError: (error) => failures.push(error),
    });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertsIn(fake.statements)).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.workspaceId).toBe(WORKSPACE_A);
    expect(failures[0]?.lostEvents).toBe(1);
  });

  it('reports the loss and releases the connection when the insert fails', async () => {
    const fake = fakeSource({ failInsert: true });
    const failures: TelemetryPersistError[] = [];
    const sink = createPostgresSink({
      source: fake.source,
      flushIntervalMs: 0,
      onError: (error) => failures.push(error),
    });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(failures).toHaveLength(1);
    expect(failures[0]?.lostEvents).toBe(1);
    expect(fake.statements.map((statement) => statement.sql)).toContain('ROLLBACK');
    expect(fake.released()).toBe(fake.acquired());
  });

  it('keeps a failing sink from breaking the write path it is attached to', async () => {
    const fake = fakeSource({ failInsert: true });
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });
    const emitter = createTelemetryEmitter({ sinks: [sink], enabled: true });

    await expect(emitter.emit(sliceShown(WORKSPACE_A, 'slice-1'))).resolves.toBeUndefined();
    await expect(emitter.flush()).resolves.toBeUndefined();
  });

  it('persists no redacted key, because the emitter strips them before the sink sees them', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });
    const emitter = createTelemetryEmitter({ sinks: [sink], enabled: true });

    await emitter.emit({
      name: 'checkpoint.item_extracted',
      workspaceId: WORKSPACE_A,
      projectId: PROJECT_ID,
      actorId: ACTOR_ID,
      sessionId: null,
      occurredAt: new Date('2026-08-09T12:00:00.000Z'),
      checkpointId: CHECKPOINT_ID,
      itemId: ITEM_ID,
      kind: 'decision',
      confidence: 0.9,
      loadBearing: true,
      trigger: 'manual',
      body: 'we ruled out Kafka because the ops burden is not worth it',
      rationale: 'the human said so',
    } as unknown as TelemetryEvent);
    await emitter.flush();

    const [insert] = insertsIn(fake.statements);
    const serialised = String(insert?.params[7]).toLowerCase();

    for (const key of REDACTED_KEYS) {
      expect(serialised).not.toContain(`"${key}"`);
    }
    expect(serialised).not.toContain('kafka');
  });

  it('counts what it delivered, so health can report landing rather than configuration', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    expect(sink.delivered).toBe(0);
    expect(sink.dropped).toBe(0);
    expect(sink.lastError).toBeNull();

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.write(sliceShown(WORKSPACE_B, 'slice-2'));
    await sink.flush();

    expect(sink.delivered).toBe(2);
    expect(sink.dropped).toBe(0);
    expect(sink.lastError).toBeNull();
  });

  it('counts what it lost, and keeps the reason, so a failure cannot read as healthy', async () => {
    const fake = fakeSource({ failInsert: true });
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await sink.write(sliceShown(WORKSPACE_A, 'slice-2'));
    await sink.flush();

    expect(sink.delivered).toBe(0);
    expect(sink.dropped).toBe(2);
    expect(sink.lastError?.message).toContain('telemetry_event');
    expect(sink.lastError?.workspaceId).toBe(WORKSPACE_A);
  });

  it('counts a write refused after close as lost too', async () => {
    const fake = fakeSource();
    const sink = createPostgresSink({ source: fake.source, flushIntervalMs: 0 });

    await sink.close();
    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));

    expect(sink.dropped).toBe(1);
  });

  it('drops nothing silently once closed — a late event is reported, not swallowed', async () => {
    const fake = fakeSource();
    const failures: TelemetryPersistError[] = [];
    const sink = createPostgresSink({
      source: fake.source,
      flushIntervalMs: 0,
      onError: (error) => failures.push(error),
    });

    await sink.close();
    await sink.write(sliceShown(WORKSPACE_A, 'slice-1'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertsIn(fake.statements)).toHaveLength(0);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.lostEvents).toBe(1);
  });
});
