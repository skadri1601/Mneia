import { describe, expect, it } from 'vitest';
import { REDACTED_KEYS, isRedactedKey, redactEvent } from './redact.js';
import type { TelemetryEvent } from './types.js';

const occurredAt = new Date('2026-08-01T09:00:00.000Z');

const baseEvent: TelemetryEvent = {
  name: 'checkpoint.item_edited',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  actorId: 'actor-1',
  sessionId: 'session-1',
  occurredAt,
  checkpointId: 'cp-1',
  itemId: 'item-1',
  fieldsChanged: ['body', 'title', 'loadBearing'],
};

const widen = (extras: Record<string, unknown>): TelemetryEvent =>
  ({ ...baseEvent, ...extras }) as TelemetryEvent;

const serialize = (event: TelemetryEvent): string => JSON.stringify(event);

describe('isRedactedKey', () => {
  it('recognises every declared key spelled as-is', () => {
    for (const key of REDACTED_KEYS) {
      expect(isRedactedKey(key)).toBe(true);
    }
  });

  it('recognises the same key across casing conventions', () => {
    const spellings = [
      'body',
      'Body',
      'BODY',
      'item_body',
      'itemBody',
      'ItemBody',
      'item-body',
      'next_action',
      'nextAction',
      'NEXT_ACTION',
      'rawText',
      'raw_text',
      'sourceContent',
      'renderedMarkdown',
    ];

    for (const spelling of spellings) {
      expect(isRedactedKey(spelling), spelling).toBe(true);
    }
  });

  it('leaves every field the §17 events actually declare alone', () => {
    const declared = [
      'name',
      'workspaceId',
      'projectId',
      'actorId',
      'sessionId',
      'occurredAt',
      'sliceId',
      'itemIds',
      'itemId',
      'tokenBudget',
      'tokensUsed',
      'durationMs',
      'checkpointId',
      'kind',
      'confidence',
      'loadBearing',
      'trigger',
      'fieldsChanged',
      'conflictId',
      'itemA',
      'itemB',
      'resolution',
      'resolvedBy',
      'previousItemId',
      'nextItemId',
      'handoffId',
      'toActor',
      'receivedBy',
      'elapsedMs',
    ];

    for (const key of declared) {
      expect(isRedactedKey(key), key).toBe(false);
    }
  });

  it('does not fire on words that merely contain a denied substring', () => {
    for (const key of ['contextItemId', 'contextWindow', 'sourceSessionId', 'noteworthyCount']) {
      expect(isRedactedKey(key), key).toBe(false);
    }
  });
});

describe('redactEvent', () => {
  it('returns a declared event untouched and reports nothing redacted', () => {
    const { event, redacted } = redactEvent(baseEvent);

    expect(event).toEqual(baseEvent);
    expect(redacted).toEqual([]);
  });

  it('keeps Date values as Date instances', () => {
    const { event } = redactEvent(baseEvent);

    expect(event.occurredAt).toBeInstanceOf(Date);
    expect(event.occurredAt.getTime()).toBe(occurredAt.getTime());
  });

  it('keeps field names that happen to name a redacted field', () => {
    const { event } = redactEvent(baseEvent);

    expect(serialize(event)).toContain('body');
    expect(Object.hasOwn(event, 'body')).toBe(false);
  });

  it('strips a top-level body-like field a widened type would introduce', () => {
    const { event, redacted } = redactEvent(widen({ body: 'the customer decided to drop Redis' }));

    expect(Object.hasOwn(event, 'body')).toBe(false);
    expect(redacted).toEqual(['body']);
  });

  it('strips body-like fields nested inside an object', () => {
    const { event, redacted } = redactEvent(
      widen({ item: { id: 'item-1', body: 'secret', kind: 'decision' } }),
    );

    expect(serialize(event)).not.toContain('secret');
    expect(redacted).toEqual(['item.body']);
    expect(event).toMatchObject({ item: { id: 'item-1', kind: 'decision' } });
  });

  it('strips body-like fields nested inside arrays', () => {
    const { event, redacted } = redactEvent(
      widen({
        items: [
          { id: 'a', summary: 'secret-a' },
          { id: 'b', summary: 'secret-b' },
        ],
      }),
    );

    expect(serialize(event)).not.toContain('secret');
    expect(redacted).toEqual(['items[0].summary', 'items[1].summary']);
  });

  it('reports every stripped path, at every depth', () => {
    const { redacted } = redactEvent(
      widen({
        body: 'one',
        outer: { inner: { transcript: 'two' }, rendered: 'three' },
      }),
    );

    expect([...redacted].sort()).toEqual(['body', 'outer.inner.transcript', 'outer.rendered']);
  });

  it('drops opaque objects rather than spreading their internals', () => {
    const { event, redacted } = redactEvent(
      widen({ carrier: new Map([['k', 'secret']]), bytes: Buffer.from('secret') }),
    );

    expect(serialize(event)).not.toContain('secret');
    expect([...redacted].sort()).toEqual(['bytes', 'carrier']);
  });

  it('does not mutate the event it was given', () => {
    const original = widen({ body: 'secret' });
    const snapshot = serialize(original);

    redactEvent(original);

    expect(serialize(original)).toBe(snapshot);
  });
});
