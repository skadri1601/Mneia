import 'server-only';

import type { EnvLike } from './health.js';

export const PROBE_TOKEN_ENV_VAR = 'MNEIA_ERROR_PROBE_TOKEN';

export type ProbeVerdict = 'unarmed' | 'rejected' | 'armed';

export class ErrorProbeError extends Error {
  constructor(label: string) {
    super(`MNEIA_ERROR_PROBE deliberate production error — ${label}`);
    this.name = 'ErrorProbeError';
  }
}

const timingSafeEquals = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
};

export const inspectProbeRequest = (
  presented: string | null,
  env: EnvLike = process.env,
): ProbeVerdict => {
  const expected = env[PROBE_TOKEN_ENV_VAR];
  if (expected === undefined || expected.trim().length === 0) {
    return 'unarmed';
  }
  if (presented === null || !timingSafeEquals(presented, expected)) {
    return 'rejected';
  }
  return 'armed';
};
