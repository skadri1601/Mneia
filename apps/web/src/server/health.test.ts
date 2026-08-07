import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import { checkHealth } from './health.js';

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

    const report = await checkHealth(sourceOf(session), noEscapeHatch);

    expect(report).toEqual({ status: 'ok', database: 'ok', rls: 'enforced' });
    expect(session.statements.at(0)).toBe('SELECT 1');
  });

  it('reports degraded when the connection cannot be acquired at all', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw new Error('DATABASE_URL must be set before acquiring a Postgres connection');
      },
      close: async () => {},
    };

    const report = await checkHealth(source, noEscapeHatch);

    expect(report.status).toBe('degraded');
    expect(report.database).toBe('unreachable');
    expect(report.detail).toContain('DATABASE_URL');
  });

  it('reports degraded when the connection opens but the query fails', async () => {
    const session = new RecordingSession(() => {
      throw new Error('terminating connection due to administrator command');
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch);

    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('terminating connection');
  });

  it('releases the connection on both the healthy and the failing path', async () => {
    const healthy = new RecordingSession();
    await checkHealth(sourceOf(healthy), noEscapeHatch);
    expect(healthy.released).toBe(1);

    const failing = new RecordingSession(() => {
      throw new Error('boom');
    });
    await checkHealth(sourceOf(failing), noEscapeHatch);
    expect(failing.released).toBe(1);
  });

  it('does not leak a non-Error throw as an empty detail', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw 'connection refused';
      },
      close: async () => {},
    };

    const report = await checkHealth(source, noEscapeHatch);

    expect(report.detail).toBe('non-Error thrown: connection refused');
  });
});

describe('checkHealth RLS posture', () => {
  it('refuses to call a connection that bypasses RLS healthy', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), noEscapeHatch);

    expect(report.rls).toBe('bypassed');
    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('row-level security');
  });

  it('names the escape hatch rather than hiding it, and does not fail the deploy gate', async () => {
    const session = new RecordingSession(undefined, bypassingRole);

    const report = await checkHealth(sourceOf(session), () => '1');

    expect(report.rls).toBe('bypassed_by_escape_hatch');
    expect(report.detail).toContain('MNEIA_ALLOW_RLS_BYPASS');
    expect(report.status).toBe('ok');
  });

  it('treats an unreadable posture as unknown rather than assuming it is fine', async () => {
    const session = new RecordingSession(undefined, {});

    const report = await checkHealth(sourceOf(session), noEscapeHatch);

    expect(report.rls).toBe('unknown');
    expect(report.status).toBe('degraded');
  });

  it('reports a superuser connection as bypassing even when the flag itself is false', async () => {
    const session = new RecordingSession(undefined, {
      ...enforcingRole,
      role_name: 'postgres',
      role_is_superuser: true,
    });

    const report = await checkHealth(sourceOf(session), noEscapeHatch);

    expect(report.rls).toBe('bypassed');
  });
});
