export const PROBE_SECRET_VAR = 'SENTRY_PROBE_SECRET';

export const PROBE_HEADER = 'x-mneia-probe';

export type ProbeVerdict = 'authorized' | 'not_configured' | 'rejected';

export type EnvLike = Readonly<Record<string, string | undefined>>;

const equalsInConstantTime = (a: string, b: string): boolean => {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
};

export const authorizeProbe = (presented: string | null, env: EnvLike): ProbeVerdict => {
  const secret = env[PROBE_SECRET_VAR];

  if (secret === undefined || secret.trim().length === 0) {
    return 'not_configured';
  }
  if (presented === null || presented.length === 0) {
    return 'rejected';
  }
  return equalsInConstantTime(presented, secret) ? 'authorized' : 'rejected';
};
