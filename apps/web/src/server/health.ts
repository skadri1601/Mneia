import 'server-only';

import type { PostgresConnectionSource, PostgresSession } from '@mneia/core';
import { inspectRlsPosture, RLS_BYPASS_ESCAPE_HATCH } from '@mneia/core';
import { database } from './database.js';

export type HealthStatus = 'ok' | 'degraded';

export type RlsHealth = 'enforced' | 'bypassed' | 'bypassed_by_escape_hatch' | 'unknown';

export type ModelHealth = 'configured' | 'no_key';

export interface HealthReport {
  readonly status: HealthStatus;
  readonly database: 'ok' | 'unreachable';
  readonly rls: RlsHealth;
  readonly extraction: ModelHealth;
  readonly extractionFallback: ModelHealth;
  readonly embeddings: ModelHealth;
  readonly detail?: string;
}

const keyed = (value: string | undefined): ModelHealth =>
  value !== undefined && value.trim().length > 0 ? 'configured' : 'no_key';

export interface ModelPosture {
  readonly extraction: ModelHealth;
  readonly extractionFallback: ModelHealth;
  readonly embeddings: ModelHealth;
}

export const inspectModelPosture = (env: NodeJS.ProcessEnv = process.env): ModelPosture => ({
  extraction: keyed(env.OPENAI_API_KEY),
  extractionFallback: keyed(env.ANTHROPIC_API_KEY),
  embeddings: keyed(env.OPENAI_API_KEY),
});

export const describeModelPosture = (posture: ModelPosture): string | null => {
  const missing: string[] = [];
  if (posture.extraction === 'no_key') {
    missing.push(
      'OPENAI_API_KEY is unset, so mneia checkpoint cannot propose anything and rehydrate ranks on recency alone',
    );
  }
  if (posture.extractionFallback === 'no_key') {
    missing.push(
      'ANTHROPIC_API_KEY is unset, so an OpenAI outage takes checkpoint down with no fallback',
    );
  }
  return missing.length === 0 ? null : missing.join('; ');
};

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
  env: NodeJS.ProcessEnv = process.env,
): Promise<HealthReport> => {
  const models = inspectModelPosture(env);
  const modelDetail = describeModelPosture(models);
  let session: PostgresSession | undefined;

  try {
    session = await source.acquire();
    await session.execute('SELECT 1');

    const { rls, detail } = await readRls(session, readEscapeHatch() === '1');
    const status: HealthStatus =
      rls === 'enforced' || rls === 'bypassed_by_escape_hatch' ? 'ok' : 'degraded';
    const combined = [detail, modelDetail].filter((part) => part !== undefined && part !== null);

    return combined.length === 0
      ? { status, database: 'ok', rls, ...models }
      : { status, database: 'ok', rls, ...models, detail: combined.join('; ') };
  } catch (error) {
    return {
      status: 'degraded',
      database: 'unreachable',
      rls: 'unknown',
      ...models,
      detail: describe(error),
    };
  } finally {
    if (session !== undefined) await session.release();
  }
};
