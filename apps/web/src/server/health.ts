import 'server-only';

import type { PostgresConnectionSource, PostgresSession } from '@mneia/core';
import {
  BOOKKEEPING_TABLE,
  inspectRlsPosture,
  MIGRATIONS,
  RLS_BYPASS_ESCAPE_HATCH,
} from '@mneia/core';
import { database } from './database.js';
import type { EnvLike as TelemetryEnvLike, TelemetryPosture } from './telemetry-runtime.js';
import { describeTelemetryPosture, planTelemetry } from './telemetry-runtime.js';

export type HealthStatus = 'ok' | 'degraded';

export type RlsHealth = 'enforced' | 'bypassed' | 'bypassed_by_escape_hatch' | 'unknown';

export type SchemaHealth = 'current' | 'behind' | 'ahead' | 'unknown';

export type EnvLike = TelemetryEnvLike;

export type ModelHealth = 'configured' | 'no_key';

export interface SchemaVersions {
  readonly expected: number;
  readonly applied: number | null;
}

export interface HealthReport {
  readonly status: HealthStatus;
  readonly database: 'ok' | 'unreachable';
  readonly rls: RlsHealth;
  readonly schema: SchemaHealth;
  readonly schemaVersion: SchemaVersions;
  readonly telemetry: TelemetryPosture;
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

export const inspectModelPosture = (env: EnvLike = process.env): ModelPosture => ({
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

export const EXPECTED_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => (migration.version > highest ? migration.version : highest),
  0,
);

interface SchemaRow {
  readonly version: number | string | null;
}

const compareSchema = (expected: number, applied: number | null): SchemaHealth => {
  if (applied === null) return 'unknown';
  if (applied === expected) return 'current';
  return applied < expected ? 'behind' : 'ahead';
};

export const describeSchemaPosture = (
  schema: SchemaHealth,
  versions: SchemaVersions,
): string | null => {
  switch (schema) {
    case 'current':
      return null;
    case 'behind':
      return `this build expects schema version ${versions.expected} but the database is at ${String(versions.applied)}; every query naming a newer column will fail until pnpm db:migrate is run against production`;
    case 'ahead':
      return `the database is at schema version ${String(versions.applied)} and this build only knows up to ${versions.expected}; it was migrated by a newer build, so deploy that build rather than downgrading the store`;
    case 'unknown':
      return `could not read ${BOOKKEEPING_TABLE}, so whether this build matches the database is unknown`;
  }
};

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : `non-Error thrown: ${String(error)}`;

const readSchema = async (
  session: PostgresSession,
): Promise<{ readonly schema: SchemaHealth; readonly versions: SchemaVersions }> => {
  const versionsWith = (applied: number | null): SchemaVersions => ({
    expected: EXPECTED_SCHEMA_VERSION,
    applied,
  });

  try {
    const result = await session.execute<SchemaRow>(
      `SELECT max(version) AS version FROM ${BOOKKEEPING_TABLE}`,
    );
    const [row] = result.rows;
    const raw = row?.version ?? null;
    const applied = raw === null ? null : Number(raw);

    if (applied !== null && !Number.isFinite(applied)) {
      return { schema: 'unknown', versions: versionsWith(null) };
    }

    return {
      schema: compareSchema(EXPECTED_SCHEMA_VERSION, applied),
      versions: versionsWith(applied),
    };
  } catch {
    return { schema: 'unknown', versions: versionsWith(null) };
  }
};

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
  env: EnvLike = process.env,
): Promise<HealthReport> => {
  const models = inspectModelPosture(env);
  const modelDetail = describeModelPosture(models);
  const plan = planTelemetry(env);
  const telemetryDetail = describeTelemetryPosture(plan);
  let session: PostgresSession | undefined;

  try {
    session = await source.acquire();
    await session.execute('SELECT 1');

    const { rls, detail } = await readRls(session, readEscapeHatch() === '1');
    const { schema, versions } = await readSchema(session);
    const schemaDetail = describeSchemaPosture(schema, versions);

    const rlsOk = rls === 'enforced' || rls === 'bypassed_by_escape_hatch';
    const schemaOk = schema === 'current' || schema === 'ahead';
    const telemetryOk = plan.posture !== 'dropped';
    const status: HealthStatus = rlsOk && schemaOk && telemetryOk ? 'ok' : 'degraded';

    const combined = [detail, schemaDetail, telemetryDetail, modelDetail].filter(
      (part): part is string => part !== undefined && part !== null,
    );

    const report: HealthReport = {
      status,
      database: 'ok',
      rls,
      schema,
      schemaVersion: versions,
      telemetry: plan.posture,
      ...models,
    };

    return combined.length === 0 ? report : { ...report, detail: combined.join('; ') };
  } catch (error) {
    return {
      status: 'degraded',
      database: 'unreachable',
      rls: 'unknown',
      schema: 'unknown',
      schemaVersion: { expected: EXPECTED_SCHEMA_VERSION, applied: null },
      telemetry: plan.posture,
      ...models,
      detail: describe(error),
    };
  } finally {
    if (session !== undefined) await session.release();
  }
};
