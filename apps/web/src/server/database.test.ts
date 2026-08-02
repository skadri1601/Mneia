import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type DatabaseClient,
  DatabaseConfigurationError,
  type DatabasePool,
  LazyPostgresConnectionSource,
} from './database.js';

const databaseUrl = 'postgres://mneia:secret@db.example/mneia';

const harness = () => {
  const query = vi.fn<DatabaseClient['query']>();
  const release = vi.fn<DatabaseClient['release']>();
  const client = { query, release } satisfies DatabaseClient;
  const connect = vi.fn<DatabasePool['connect']>().mockResolvedValue(client);
  const end = vi.fn<DatabasePool['end']>().mockResolvedValue(undefined);
  const pool = { connect, end } satisfies DatabasePool;
  const createPool = vi.fn(() => pool);
  const readDatabaseUrl = vi.fn((): string | undefined => databaseUrl);
  const source = new LazyPostgresConnectionSource({ createPool, readDatabaseUrl });

  return { source, query, release, connect, end, createPool, readDatabaseUrl };
};

describe('LazyPostgresConnectionSource', () => {
  it('does not read configuration or create a pool during construction', () => {
    const { createPool, readDatabaseUrl } = harness();

    expect(readDatabaseUrl).not.toHaveBeenCalled();
    expect(createPool).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   '])(
    'rejects an unusable DATABASE_URL during acquisition',
    async (url) => {
      const { createPool } = harness();
      const readDatabaseUrl = vi.fn(() => url);
      const invalidSource = new LazyPostgresConnectionSource({
        createPool,
        readDatabaseUrl,
      });

      await expect(invalidSource.acquire()).rejects.toBeInstanceOf(DatabaseConfigurationError);
      await expect(invalidSource.acquire()).rejects.toThrow('DATABASE_URL');
      expect(createPool).not.toHaveBeenCalled();
    },
  );

  it('creates the pool lazily and maps query rows through the core SQL contract', async () => {
    const { source, query, connect, createPool } = harness();
    query.mockResolvedValue({ rows: [{ value: 'mapped' }] });

    const session = await source.acquire();
    const result = await session.execute<{ value: string }>('SELECT $1::text AS value', ['mapped']);

    expect(createPool).toHaveBeenCalledOnce();
    expect(createPool).toHaveBeenCalledWith(databaseUrl);
    expect(connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledWith('SELECT $1::text AS value', ['mapped']);
    expect(result).toEqual({ rows: [{ value: 'mapped' }] });
  });

  it('returns a healthy client to the pool on release', async () => {
    const { source, release } = harness();

    const session = await source.acquire();
    await session.release();

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith();
  });

  it('force-destroys an unusable client on discard', async () => {
    const { source, release } = harness();

    const session = await source.acquire();
    await session.discard();

    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(true);
  });

  it('closes only a pool that acquisition already initialized', async () => {
    const cold = harness();

    await cold.source.close();

    expect(cold.createPool).not.toHaveBeenCalled();
    expect(cold.end).not.toHaveBeenCalled();

    const warm = harness();
    await warm.source.acquire();
    await warm.source.close();

    expect(warm.end).toHaveBeenCalledOnce();
  });
});
