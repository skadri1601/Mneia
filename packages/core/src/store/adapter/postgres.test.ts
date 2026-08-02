import { describe, expect, it } from 'vitest';
import type { SqlResult, SqlValue } from '../driver.js';
import type { PostgresConnectionSource, PostgresSession } from './postgres.js';
import { PostgresStoreAdapter, type StoreError } from './postgres.js';

const SCOPE = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
};

class FakeSession implements PostgresSession {
  readonly calls: string[] = [];
  releaseCount = 0;
  discardCount = 0;

  constructor(private readonly rollbackFailure: Error | null = null) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.calls.push(sql);
    if (sql === 'ROLLBACK' && this.rollbackFailure !== null) {
      throw this.rollbackFailure;
    }
    return { rows: [] };
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }

  async discard(): Promise<void> {
    this.discardCount += 1;
  }
}

class FakeSource implements PostgresConnectionSource {
  constructor(readonly session: FakeSession) {}

  async acquire(): Promise<PostgresSession> {
    return this.session;
  }

  async close(): Promise<void> {}
}

describe('PostgresStoreAdapter transaction cleanup', () => {
  it('releases the session after a successful rollback', async () => {
    const session = new FakeSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));
    const failure = new Error('write failed');

    await expect(
      adapter.withScope(SCOPE, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(session.calls).toEqual(['BEGIN', 'SELECT set_config($1, $2, true)', 'ROLLBACK']);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('discards an unusable session after rollback fails', async () => {
    const rollbackFailure = new Error('rollback failed');
    const session = new FakeSession(rollbackFailure);
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, async () => {
        throw new Error('write failed');
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'rollback_failed',
      cause: rollbackFailure,
    } satisfies Partial<StoreError>);
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });
});
