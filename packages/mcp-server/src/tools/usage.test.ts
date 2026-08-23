import type { ScopedStore, TelemetryEmitter, UsageWire, Uuid } from '@mneia/core';
import { createNoopEmitter } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { createToolContextFixture } from './context-fixture.js';
import type { UsageProbe } from './usage.js';
import { readUsage, usageBlock, usageWarningBlock } from './usage.js';

const WORKSPACE_ID: Uuid = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID: Uuid = '22222222-2222-4222-8222-222222222222';

const CAPPED: UsageWire = {
  plan: 'solo',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: { used: 1600, allowance: 5000, fraction: 0.32 },
  extractions: { used: 12, allowance: 50, fraction: 0.24 },
  checkpoints: 7,
  percentUsed: 32,
  warn: false,
};

const FRESH: UsageWire = {
  ...CAPPED,
  turns: { used: 0, allowance: 5000, fraction: 0 },
  extractions: { used: 0, allowance: 50, fraction: 0 },
  checkpoints: 0,
  percentUsed: 0,
};

const UNCAPPED: UsageWire = {
  ...CAPPED,
  plan: 'enterprise',
  turns: { used: 1600, allowance: null, fraction: null },
  extractions: { used: 12, allowance: null, fraction: null },
  percentUsed: null,
};

const WARNING: UsageWire = { ...CAPPED, percentUsed: 91, warn: true };

const emptyStore = (): ScopedStore =>
  ({ scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID } }) as unknown as ScopedStore;

const contextWith = (usage?: UsageProbe | undefined) =>
  createToolContextFixture(emptyStore(), createNoopEmitter() as TelemetryEmitter, { usage });

describe('usageBlock', () => {
  it('carries every wire field through untouched', () => {
    const block = usageBlock(CAPPED);
    expect(block).toMatchObject(CAPPED);
  });

  it('never carries the embedding dial, which is recorded and never shown', () => {
    const block = usageBlock(CAPPED);
    expect(JSON.stringify(block)).not.toContain('embedding');
  });

  it('says which percentage was used, and when the period resets', () => {
    const block = usageBlock(CAPPED);
    expect(block?.summary).toContain('32% of this period');
    expect(block?.summary).toContain('1600 of 5000 turns');
    expect(block?.summary).toContain('12 of 50 extractions');
    expect(block?.summary).toContain('Resets 2026-09-01');
  });

  it('reads a brand-new workspace as zero used, not as unknown', () => {
    const block = usageBlock(FRESH);
    expect(block?.percentUsed).toBe(0);
    expect(block?.summary).toContain('0% of this period');
    expect(block?.summary).toContain('0 of 5000 turns');
  });

  it('says "no capped allowance" rather than leaving a null percentage to be guessed at', () => {
    const block = usageBlock(UNCAPPED);
    expect(block?.percentUsed).toBeNull();
    expect(block?.summary).toContain('no capped allowance');
    expect(block?.summary).toContain('1600 turns (uncapped)');
    expect(block?.summary).not.toContain('%');
  });

  it('tells the agent to surface a workspace close to its limit', () => {
    const block = usageBlock(WARNING);
    expect(block?.warn).toBe(true);
    expect(block?.summary).toContain('91%');
    expect(block?.summary).toContain('Tell the human');
  });

  it('is null when there is nothing to report', () => {
    expect(usageBlock(null)).toBeNull();
  });
});

describe('usageWarningBlock', () => {
  it('adds a content block only once the meter is in warning', () => {
    expect(usageWarningBlock(usageBlock(CAPPED))).toBeNull();
    expect(usageWarningBlock(null)).toBeNull();
    expect(usageWarningBlock(usageBlock(WARNING))).toEqual({
      type: 'text',
      text: usageBlock(WARNING)?.summary,
    });
  });
});

describe('readUsage', () => {
  it('reports nothing when the surface has no meter behind it', async () => {
    expect(await readUsage(contextWith(undefined))).toBeNull();
  });

  it('reports nothing when the probe resolves null', async () => {
    expect(await readUsage(contextWith(() => Promise.resolve(null)))).toBeNull();
  });

  it('never lets a failing meter fail the tool call that read it', async () => {
    const throwing: UsageProbe = () => Promise.reject(new Error('billing query timed out'));
    await expect(readUsage(contextWith(throwing))).resolves.toBeNull();
  });

  it('never lets a synchronously throwing probe escape either', async () => {
    const throwing: UsageProbe = () => {
      throw new Error('billing store unreachable');
    };
    await expect(readUsage(contextWith(throwing))).resolves.toBeNull();
  });

  it('returns the meter when the probe answers', async () => {
    const block = await readUsage(contextWith(() => Promise.resolve(CAPPED)));
    expect(block?.percentUsed).toBe(32);
    expect(block?.plan).toBe('solo');
  });
});
