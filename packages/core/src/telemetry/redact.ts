import type { TelemetryEvent } from './types.js';

export const REDACTED_KEYS = [
  'blob',
  'bodies',
  'body',
  'chunk',
  'comment',
  'comments',
  'completion',
  'content',
  'contents',
  'conversation',
  'description',
  'diff',
  'document',
  'excerpt',
  'itembody',
  'message',
  'messages',
  'nextaction',
  'note',
  'notes',
  'patch',
  'payload',
  'plaintext',
  'prompt',
  'query',
  'rationale',
  'raw',
  'rawtext',
  'reason',
  'rendered',
  'response',
  'richtext',
  'snippet',
  'summary',
  'text',
  'title',
  'trajectory',
  'transcript',
] as const;

const DENIED = new Set<string>(REDACTED_KEYS);

const compact = (key: string): string => key.replace(/[^A-Za-z0-9]+/g, '').toLowerCase();

const words = (key: string): readonly string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

export function isRedactedKey(key: string): boolean {
  if (DENIED.has(compact(key))) {
    return true;
  }
  return words(key).some((word) => DENIED.has(word));
}

function isOpaqueValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype !== Object.prototype && prototype !== null;
}

const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

function stripValue(value: unknown, path: string, redacted: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      const child = `${path}[${index}]`;
      if (isOpaqueValue(entry)) {
        redacted.push(child);
        return undefined;
      }
      return stripValue(entry, child, redacted);
    });
  }

  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  const kept: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const child = join(path, key);
    if (isRedactedKey(key) || isOpaqueValue(entry)) {
      redacted.push(child);
      continue;
    }
    kept[key] = stripValue(entry, child, redacted);
  }
  return kept;
}

export interface Redaction<TEvent extends TelemetryEvent = TelemetryEvent> {
  readonly event: TEvent;
  readonly redacted: readonly string[];
}

export function redactEvent<TEvent extends TelemetryEvent>(event: TEvent): Redaction<TEvent> {
  const redacted: string[] = [];
  if (isOpaqueValue(event)) {
    return { event, redacted };
  }
  const stripped = stripValue(event, '', redacted) as TEvent;
  return { event: stripped, redacted };
}
