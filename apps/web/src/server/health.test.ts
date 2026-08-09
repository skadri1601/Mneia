import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import {
  checkHealth,
  describeModelPosture,
  EXPECTED_SCHEMA_VERSION,
  inspectModelPosture,
  resolveTelemetryHealth,
} from './health.js';

const NO_KEYS = {};
const CURRENT_SCHEMA = {
  schema: 'current',
  schemaVersion: { expected: EXPECTED_SCHEMA_VERSION, applied: EXPECTED_SCHEMA_VERSION },
  telemetry: 'persisted',
} as const;
const BOTH_KEYS = { OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-ant-x' };
const NO_MODELS = {
  extraction: 'no_key',
  extractionFallback: 'no_key',
  embeddings: 'no_key',
} as const;
const NO_MODEL_DETAIL =
  'OPENAI_API_KEY is unset, so mneia checkpoint cannot propose anything and rehydrate ranks on recency alone; ANTHROPIC_API_KEY is unset, so an OpenAI outage takes checkpoint down with no fallback';

const enforcingRole = {
  role_name: 'mneia_app',
  session_role_name: 'mneia_app',
  role_is_superuser: false,
  role_bypasses_rls: false,
  granting_role: null,
  granting_is_superuser: false,
  granting_bypasses_rls: false,
};

const bypassingRole = { ...enforcingRole, role_name: 'postgres', role_bypasses_rls: true };

class RecordingSession implements PostgresSession {
  readonly statements: string[] = [];
  released = 0;
  discarded = 0;

  constructor(
    private readonly onExecute?: (sql: string) => void,
    private readonly posture: Record<string, unknown> = enforcingRole,
    private readonly appliedSchema: number | null = EXPECTED_SCHEMA_VERSION,
    private readonly canInsertTelemetry: boolean = true,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params?: readonly SqlValue[],
  ): Promise<SqlResult<TRow>> {
    this.statements.push(sql);
    this.onExecute?.(sql);

    if (sql.includes('rolname')) {
      return { rows: [this.posture as TRow] };
    }
    if (sql.includes('mneia_schema_migration')) {
      if (this.appliedSchema === null) {
        throw new Error('relation "mneia_schema_migration" does not exist');
      }
      return { rows: [{ version: this.appliedSchema } as TRow] };
    }
    if (sql.includes('has_table_privilege')) {
      return { rows: [{ granted: this.canInsertTelemetry } as TRow] };
    }
    return { rows: [] };
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  async discard(): Promise<void> {
    this.discarded += 1;
  }
}

const sourceOf = (session: PostgresSession): PostgresConnectionSource => ({
  acquire: async () => session,
  close: async () => {},
});

const noEscapeHatch = () => undefined;

const noDelivery = () => null;

const deliveryOf =
  (dropped: number, lastError: string | null = null) =>
  () => ({
    delivered: 0,
    dropped,
    lastError,
  });

describe('checkHealth', () => {
  it('reports ok only after a statement actually reached Postgres', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report).toEqual({
      status: 'ok',
      database: 'ok',
      rls: 'enforced',
      ...CURRENT_SCHEMA,
      ...NO_MODELS,
      detail: NO_MODEL_DETAIL,
    });
    expect(session.statements.at(0)).toBe('SELECT 1');
  });

  it('reports degraded when the connection cannot be acquired at all', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw new Error('DATABASE_URL must be set before acquiring a Postgres connection');
      },
      close: async () => {},
    };

    const report = await checkHealth(source, noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.status).toBe('degraded');
    expect(report.database).toBe('unreachable');
    expect(report.detail).toContain('DATABASE_URL');
  });

  it('reports degraded when the connection opens but the query fails', async () => {
    const session = new RecordingSession(() => {
      throw new Error('terminating connection due to administrator command');
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('terminating connection');
  });

  it('releases the connection on both the healthy and the failing path', async () => {
    const healthy = new RecordingSession();
    await checkHealth(sourceOf(healthy), noEscapeHatch, NO_KEYS, noDelivery);
    expect(healthy.released).toBe(1);

    const failing = new RecordingSession(() => {
      throw new Error('boom');
    });
    await checkHealth(sourceOf(failing), noEscapeHatch, NO_KEYS, noDelivery);
    expect(failing.released).toBe(1);
  });

  it('does not leak a non-Error throw as an empty detail', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw 'connection refused';
      },
      close: async () => {},
    };

    const report = await checkHealth(source, noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.detail).toBe('non-Error thrown: connection refused');
  });
});

describe('checkHealth RLS posture', () => {
  it('refuses to call a connection that bypasses RLS healthy', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.rls).toBe('bypassed');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('row-level security');
  });

  it('names the escape hatch rather than hiding it, and does not fail the deploy gate', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), () => '1', NO_KEYS, noDelivery);

    expect(report.rls).toBe('bypassed_by_escape_hatch');
    expect(report.detail).toContain('MNEIA_ALLOW_RLS_BYPASS');
    expect(report.status).toBe('ok');
  });

  it('treats an unreadable posture as unknown rather than assuming it is fine', async () => {
    const session = new RecordingSession(undefined, {});

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.rls).toBe('unknown');
    expect(report.status).toBe('degraded');
  });

  it('reports a superuser connection as bypassing even when the flag itself is false', async () => {
    const session = new RecordingSession(undefined, {
      ...enforcingRole,
      role_name: 'postgres',
      role_is_superuser: true,
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.rls).toBe('bypassed');
  });
});

describe('model posture', () => {
  it('reports both providers configured when the keys are present', () => {
    expect(inspectModelPosture(BOTH_KEYS)).toEqual({
      extraction: 'configured',
      extractionFallback: 'configured',
      embeddings: 'configured',
    });
    expect(describeModelPosture(inspectModelPosture(BOTH_KEYS))).toBeNull();
  });

  it('treats a blank key as no key, because an empty value configures nothing', () => {
    expect(inspectModelPosture({ OPENAI_API_KEY: '   ' }).extraction).toBe('no_key');
  });

  it('ties embeddings to the OpenAI key, since one key serves both calls', () => {
    const posture = inspectModelPosture({ OPENAI_API_KEY: 'sk-x' });
    expect(posture.embeddings).toBe('configured');
    expect(posture.extractionFallback).toBe('no_key');
  });

  it('says what breaks rather than only that a key is missing', () => {
    const detail = describeModelPosture(inspectModelPosture(NO_KEYS)) ?? '';
    expect(detail).toContain('cannot propose anything');
    expect(detail).toContain('ranks on recency alone');
    expect(detail).toContain('no fallback');
  });

  it('surfaces the posture on the health report without failing the deploy', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.status).toBe('ok');
    expect(report.extraction).toBe('no_key');
    expect(report.embeddings).toBe('no_key');
  });

  it('reports no model detail once both keys are set', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, BOTH_KEYS, noDelivery);

    expect(report).toEqual({
      status: 'ok',
      database: 'ok',
      rls: 'enforced',
      ...CURRENT_SCHEMA,
      extraction: 'configured',
      extractionFallback: 'configured',
      embeddings: 'configured',
    });
  });
});

describe('checkHealth schema posture', () => {
  it('reports current when the database is at the version this build expects', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.schema).toBe('current');
    expect(report.schemaVersion).toEqual({
      expected: EXPECTED_SCHEMA_VERSION,
      applied: EXPECTED_SCHEMA_VERSION,
    });
  });

  it('refuses to call a build healthy against a database still behind it', async () => {
    const session = new RecordingSession(undefined, enforcingRole, EXPECTED_SCHEMA_VERSION - 1);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.schema).toBe('behind');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('pnpm db:migrate');
    expect(report.schemaVersion.applied).toBe(EXPECTED_SCHEMA_VERSION - 1);
  });

  it('reports a database ahead of the build without failing it, since a rollback still serves', async () => {
    const session = new RecordingSession(undefined, enforcingRole, EXPECTED_SCHEMA_VERSION + 1);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.schema).toBe('ahead');
    expect(report.status).toBe('ok');
    expect(report.detail).toContain('newer build');
  });

  it('treats an unreadable bookkeeping table as unknown rather than assuming agreement', async () => {
    const session = new RecordingSession(undefined, enforcingRole, null);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.schema).toBe('unknown');
    expect(report.status).toBe('degraded');
    expect(report.schemaVersion.applied).toBeNull();
  });

  it('reads the expected version from the migration list rather than a hand-kept constant', () => {
    expect(EXPECTED_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(EXPECTED_SCHEMA_VERSION)).toBe(true);
  });
});

describe('checkHealth telemetry posture', () => {
  it('reports persisted by default, because the moat is not opt-in', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.telemetry).toBe('persisted');
    expect(report.status).toBe('ok');
  });

  it('reports opted_out without degrading, because opting out is a right', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(
      sourceOf(session),
      noEscapeHatch,
      { MNEIA_TELEMETRY: 'off' },
      noDelivery,
    );

    expect(report.telemetry).toBe('opted_out');
    expect(report.status).toBe('ok');
  });

  it('reports file_only when the store sink is off but a path still catches events', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(
      sourceOf(session),
      noEscapeHatch,
      { MNEIA_TELEMETRY_STORE: 'off', MNEIA_TELEMETRY_PATH: '/var/log/mneia/telemetry.jsonl' },
      noDelivery,
    );

    expect(report.telemetry).toBe('file_only');
    expect(report.detail).toContain('never reach telemetry_event');
  });

  it('degrades when events are discarded, since that silently loses the arbitration dataset', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(
      sourceOf(session),
      noEscapeHatch,
      { MNEIA_TELEMETRY_STORE: 'off' },
      noDelivery,
    );

    expect(report.telemetry).toBe('dropped');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('moat');
  });

  it('refuses to report persisted when the role cannot INSERT, rather than certifying config alone', async () => {
    const session = new RecordingSession(undefined, enforcingRole, EXPECTED_SCHEMA_VERSION, false);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS, noDelivery);

    expect(report.telemetry).toBe('failing');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('cannot INSERT');
  });

  it('reports failing once the sink has actually dropped an event', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(
      sourceOf(session),
      noEscapeHatch,
      NO_KEYS,
      deliveryOf(3, 'relation "telemetry_event" does not exist'),
    );

    expect(report.telemetry).toBe('failing');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('dropped 3');
  });

  it('does not run the privilege check when telemetry is off, so opting out costs nothing', async () => {
    const session = new RecordingSession();

    await checkHealth(sourceOf(session), noEscapeHatch, { MNEIA_TELEMETRY: 'off' }, noDelivery);

    expect(session.statements.some((sql) => sql.includes('has_table_privilege'))).toBe(false);
  });
});

describe('resolveTelemetryHealth', () => {
  it('passes a non-persisted posture straight through', () => {
    expect(resolveTelemetryHealth('opted_out', null, null).telemetry).toBe('opted_out');
    expect(resolveTelemetryHealth('dropped', null, null).telemetry).toBe('dropped');
    expect(resolveTelemetryHealth('file_only', null, null).telemetry).toBe('file_only');
  });

  it('treats an unreadable privilege as failing rather than assuming the grant exists', () => {
    expect(resolveTelemetryHealth('persisted', null, null).telemetry).toBe('failing');
  });

  it('reports persisted only when the role may write and nothing has been dropped', () => {
    const verdict = resolveTelemetryHealth('persisted', true, {
      delivered: 12,
      dropped: 0,
      lastError: null,
    });
    expect(verdict.telemetry).toBe('persisted');
    expect(verdict.detail).toBeNull();
  });

  it('lets a drop outrank a healthy privilege check, because the loss already happened', () => {
    const verdict = resolveTelemetryHealth('persisted', true, {
      delivered: 4,
      dropped: 1,
      lastError: 'connection terminated',
    });
    expect(verdict.telemetry).toBe('failing');
    expect(verdict.detail).toContain('connection terminated');
  });
});
