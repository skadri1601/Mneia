import 'server-only';

import type { TelemetryEmitter, TelemetrySink } from '@mneia/core';
import { createJsonlSink, createNoopEmitter, createTelemetryEmitter } from '@mneia/core';

export const TELEMETRY_PATH_VAR = 'MNEIA_TELEMETRY_PATH';

const build = (): TelemetryEmitter => {
  const filePath = process.env[TELEMETRY_PATH_VAR];
  if (filePath === undefined || filePath.length === 0) {
    return createNoopEmitter();
  }

  const sinks: readonly TelemetrySink[] = [createJsonlSink({ filePath, name: 'web' })];
  return createTelemetryEmitter({ sinks, env: process.env });
};

let emitter: TelemetryEmitter | null = null;

export const telemetry = (): TelemetryEmitter => {
  emitter ??= build();
  return emitter;
};
