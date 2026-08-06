import 'server-only';

import type { PostgresConnectionSource } from '@mneia/core';
import { database } from './database.js';

export type HealthStatus = 'ok' | 'degraded';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly database: 'ok' | 'unreachable';
  readonly detail?: string;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : `non-Error thrown: ${String(error)}`;

export const checkHealth = async (
  source: PostgresConnectionSource = database,
): Promise<HealthReport> => {
  let session: Awaited<ReturnType<PostgresConnectionSource['acquire']>> | undefined;

  try {
    session = await source.acquire();
    await session.execute('SELECT 1');
    return { status: 'ok', database: 'ok' };
  } catch (error) {
    return { status: 'degraded', database: 'unreachable', detail: describe(error) };
  } finally {
    if (session !== undefined) await session.release();
  }
};
