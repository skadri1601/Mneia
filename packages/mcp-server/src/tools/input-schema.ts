const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function close(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(close);
  }
  if (!isRecord(node)) {
    return node;
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    next[key] = close(value);
  }
  if (next.type === 'object' && isRecord(next.properties)) {
    next.additionalProperties = false;
  }
  return next;
}

// A tool advertises a closed object so a validating client refuses a misspelled or smuggled field
// before the call is made. The runtime parse stays permissive and strips instead of rejecting, so a
// non-validating client is neutralised rather than denied service — see the GUARD tests on
// mneia_assert, which pin both halves.
export function closedInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const closed = close(schema);
  return isRecord(closed) ? closed : schema;
}
