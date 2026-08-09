import 'server-only';

import type { PostgresTelemetrySink, TelemetryEmitter, TelemetrySink } from '@mneia/core';
import {
  createJsonlSink,
  createPostgresSink,
  createTelemetryEmitter,
  telemetryEnabledIn,
} from '@mneia/core';
import { database } from './database.js';

export const TELEMETRY_PATH_VAR = 'MNEIA_TELEMETRY_PATH';

export const TELEMETRY_STORE_VAR = 'MNEIA_TELEMETRY_STORE';

export const TELEMETRY_STORE_OFF_VALUES = ['off', 'false', 'no', 'none', '0'] as const;

export const WEB_FLUSH_INTERVAL_MS = 500;

export const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface TelemetryDelivery {
  readonly delivered: number;
  readonly dropped: number;
  readonly lastError: string | null;
}

export type TelemetryPosture = 'persisted' | 'file_only' | 'opted_out' | 'dropped';

export interface TelemetryPlan {
  readonly posture: TelemetryPosture;
  readonly store: boolean;
  readonly filePath: string | null;
}

const OFF = new Set<string>(TELEMETRY_STORE_OFF_VALUES);

const storeEnabledIn = (env: EnvLike): boolean => {
  const configured = env[TELEMETRY_STORE_VAR];
  if (configured === undefined) {
    return true;
  }
  return !OFF.has(configured.trim().toLowerCase());
};

export const planTelemetry = (env: EnvLike = process.env): TelemetryPlan => {
  if (!telemetryEnabledIn(env)) {
    return { posture: 'opted_out', store: false, filePath: null };
  }

  const store = storeEnabledIn(env);
  const configured = env[TELEMETRY_PATH_VAR];
  const filePath = configured !== undefined && configured.length > 0 ? configured : null;

  if (store) {
    return { posture: 'persisted', store, filePath };
  }
  return {
    posture: filePath === null ? 'dropped' : 'file_only',
    store,
    filePath,
  };
};

export const describeTelemetryPosture = (plan: TelemetryPlan): string | null => {
  switch (plan.posture) {
    case 'persisted':
      return null;
    case 'file_only':
      return `${TELEMETRY_STORE_VAR} is off, so §17 events reach ${plan.filePath} on this container's disk and never reach telemetry_event`;
    case 'opted_out':
      return 'MNEIA_TELEMETRY is off, so no §17 event is recorded anywhere';
    case 'dropped':
      return `${TELEMETRY_STORE_VAR} is off and ${TELEMETRY_PATH_VAR} is unset, so every §17 event is discarded — this loses the arbitration dataset docs/BUSINESS.md calls the moat`;
  }
};

let emitter: TelemetryEmitter | null = null;
let storeSink: PostgresTelemetrySink | null = null;
let shutdownRegistered = false;

const registerShutdownFlush = (built: TelemetryEmitter): void => {
  if (shutdownRegistered) {
    return;
  }
  shutdownRegistered = true;

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      void built.close().catch(() => undefined);
    });
  }
};

const build = (): TelemetryEmitter => {
  const plan = planTelemetry();
  const sinks: TelemetrySink[] = [];

  if (plan.store) {
    const sink = createPostgresSink({
      source: database,
      name: 'web',
      flushIntervalMs: WEB_FLUSH_INTERVAL_MS,
      onError: (error) => {
        console.error(error.message);
      },
    });
    storeSink = sink;
    sinks.push(sink);
  }

  if (plan.filePath !== null) {
    sinks.push(createJsonlSink({ filePath: plan.filePath, name: 'web-jsonl' }));
  }

  const built = createTelemetryEmitter({ sinks, env: process.env });
  if (sinks.length > 0) {
    registerShutdownFlush(built);
  }
  return built;
};

export const telemetry = (): TelemetryEmitter => {
  emitter ??= build();
  return emitter;
};

export const telemetryDelivery = (): TelemetryDelivery | null => {
  telemetry();

  if (storeSink === null) {
    return null;
  }
  return {
    delivered: storeSink.delivered,
    dropped: storeSink.dropped,
    lastError: storeSink.lastError?.message ?? null,
  };
};
