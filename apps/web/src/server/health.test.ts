import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import { checkHealth } from './health.js';

class RecordingSession implements PostgresSession {
  readonly statements: string[] = [];
  released = 0;
  discarded = 0;

  constructor(private readonly onExecute?: (sql: string) => void) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params?: readonly SqlValue[],
  ): Promise<SqlResult<TRow>> {
    this.statements.push(sql);
    this.onExecute?.(sql);
    return { rows: [] as readonly TRow[] };
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
});

describe('checkHealth', () => {
  it('reports ok only after a statement actually reached Postgres', async () => {
    const session = new RecordingSession();

    const report = await checkHealth(sourceOf(session));

    expect(report).toEqual({ status: 'ok', database: 'ok' });
    expect(session.statements).toEqual(['SELECT 1']);
  });

  it('reports degraded when the connection cannot be acquired at all', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw new Error('DATABASE_URL must be set before acquiring a Postgres connection');
      },
    };

    const report = await checkHealth(source);

    expect(report.status).toBe('degraded');
    expect(report.database).toBe('unreachable');
    expect(report.detail).toContain('DATABASE_URL');
  });

  it('reports degraded when the connection opens but the query fails', async () => {
    const session = new RecordingSession(() => {
      throw new Error('terminating connection due to administrator command');
    });

    const report = await checkHealth(sourceOf(session));

    expect(report.status).toBe('degraded');
    expect(report.detail).toContain('terminating connection');
  });

  it('releases the connection on both the healthy and the failing path', async () => {
    const healthy = new RecordingSession();
    await checkHealth(sourceOf(healthy));
    expect(healthy.released).toBe(1);

    const failing = new RecordingSession(() => {
      throw new Error('boom');
    });
    await checkHealth(sourceOf(failing));
    expect(failing.released).toBe(1);
  });

  it('does not leak a non-Error throw as an empty detail', async () => {
    const source: PostgresConnectionSource = {
      acquire: async () => {
        throw 'connection refused';
      },
    };

    const report = await checkHealth(source);

    expect(report.detail).toBe('non-Error thrown: connection refused');
  });
});
