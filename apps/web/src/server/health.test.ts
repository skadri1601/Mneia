import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import { checkHealth, describeModelPosture, inspectModelPosture } from './health.js';

const NO_KEYS = {} as NodeJS.ProcessEnv;
const BOTH_KEYS = { OPENAI_API_KEY: 'sk-x', ANTHROPIC_API_KEY: 'sk-ant-x' } as NodeJS.ProcessEnv;
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
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params?: readonly SqlValue[],
  ): Promise<SqlResult<TRow>> {
    this.statements.push(sql);
    this.onExecute?.(sql);
    const rows = sql.includes('rolname') ? [this.posture as TRow] : [];
    return { rows: rows as readonly TRow[] };
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

describe('checkHealth', () => {
  it('reports ok only after a statement actually reached Postgres', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

    expect(report).toEqual({
      status: 'ok',
      database: 'ok',
      rls: 'enforced',
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

    const report = await checkHealth(source, noEscapeHatch, NO_KEYS);

    expect(report.status).toBe('degraded');
    expect(report.database).toBe('unreachable');
    expect(report.detail).toContain('DATABASE_URL');
  });

  it('reports degraded when the connection opens but the query fails', async () => {
    const session = new RecordingSession(() => {
      throw new Error('terminating connection due to administrator command');
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('terminating connection');
  });

  it('releases the connection on both the healthy and the failing path', async () => {
    const healthy = new RecordingSession();
    await checkHealth(sourceOf(healthy), noEscapeHatch, NO_KEYS);
    expect(healthy.released).toBe(1);

    const failing = new RecordingSession(() => {
      throw new Error('boom');
    });
    await checkHealth(sourceOf(failing), noEscapeHatch, NO_KEYS);
    expect(failing.released).toBe(1);
  });

  it('does not leak a non-Error throw as an empty detail', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw 'connection refused';
      },
      close: async () => {},
    };

    const report = await checkHealth(source, noEscapeHatch, NO_KEYS);

    expect(report.detail).toBe('non-Error thrown: connection refused');
  });
});

describe('checkHealth RLS posture', () => {
  it('refuses to call a connection that bypasses RLS healthy', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

    expect(report.rls).toBe('bypassed');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('row-level security');
  });

  it('names the escape hatch rather than hiding it, and does not fail the deploy gate', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), () => '1', NO_KEYS);

    expect(report.rls).toBe('bypassed_by_escape_hatch');
    expect(report.detail).toContain('MNEIA_ALLOW_RLS_BYPASS');
    expect(report.status).toBe('ok');
  });

  it('treats an unreadable posture as unknown rather than assuming it is fine', async () => {
    const session = new RecordingSession(undefined, {});

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

    expect(report.rls).toBe('unknown');
    expect(report.status).toBe('degraded');
  });

  it('reports a superuser connection as bypassing even when the flag itself is false', async () => {
    const session = new RecordingSession(undefined, {
      ...enforcingRole,
      role_name: 'postgres',
      role_is_superuser: true,
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

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
    expect(inspectModelPosture({ OPENAI_API_KEY: '   ' } as NodeJS.ProcessEnv).extraction).toBe(
      'no_key',
    );
  });

  it('ties embeddings to the OpenAI key, since one key serves both calls', () => {
    const posture = inspectModelPosture({ OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv);
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

    const report = await checkHealth(sourceOf(session), noEscapeHatch, NO_KEYS);

    expect(report.status).toBe('ok');
    expect(report.extraction).toBe('no_key');
    expect(report.embeddings).toBe('no_key');
  });

  it('reports no model detail once both keys are set', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session), noEscapeHatch, BOTH_KEYS);

    expect(report).toEqual({
      status: 'ok',
      database: 'ok',
      rls: 'enforced',
      extraction: 'configured',
      extractionFallback: 'configured',
      embeddings: 'configured',
    });
  });
});
