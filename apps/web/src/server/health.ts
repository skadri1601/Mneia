import 'server-only';

import type { PostgresConnectionSource, PostgresSession } from '@mneia/core';
import { RLS_BYPASS_ESCAPE_HATCH, inspectRlsPosture } from '@mneia/core';
import { database } from './database.js';

export type HealthStatus = 'ok' | 'degraded';

export type RlsHealth = 'enforced' | 'bypassed' | 'bypassed_by_escape_hatch' | 'unknown';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly database: 'ok' | 'unreachable';
  readonly rls: RlsHealth;
  readonly detail?: string;
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : `non-Error thrown: ${String(error)}`;

const readRls = async (
  session: PostgresSession,
  escapeHatchSet: boolean,
): Promise<{ readonly rls: RlsHealth; readonly detail?: string }> => {
  try {
    const posture = await inspectRlsPosture(session);
    if (!posture.bypassesRls) {
      return { rls: 'enforced' };
    }
    return escapeHatchSet
      ? {
          rls: 'bypassed_by_escape_hatch',
          detail: `${RLS_BYPASS_ESCAPE_HATCH} is set, so workspace isolation is not enforced on this connection`,
        }
      : {
          rls: 'bypassed',
          detail:
            'the application role bypasses row-level security, so every store request will be refused',
        };
  } catch (error) {
    return { rls: 'unknown', detail: describe(error) };
  }
};

export const checkHealth = async (
  source: PostgresConnectionSource = database,
  readEscapeHatch: () => string | undefined = () => process.env[RLS_BYPASS_ESCAPE_HATCH],
): Promise<HealthReport> => {
  let session: PostgresSession | undefined;

  try {
    session = await source.acquire();
    await session.execute('SELECT 1');

    const { rls, detail } = await readRls(session, readEscapeHatch() === '1');
    const status: HealthStatus =
      rls === 'enforced' || rls === 'bypassed_by_escape_hatch' ? 'ok' : 'degraded';

    return detail === undefined
      ? { status, database: 'ok', rls }
      : { status, database: 'ok', rls, detail };
  } catch (error) {
    return { status: 'degraded', database: 'unreachable', rls: 'unknown', detail: describe(error) };
  } finally {
    if (session !== undefined) await session.release();
  }
};
