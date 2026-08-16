import type { CheckpointProposeWire, ContextItem, Project, ScopedStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { handleProposeCheckpoint } = await import('./propose.js');
const { ApiRequestError } = await import('./handlers.js');
const { ExtractionRunError } = await import('../extraction/select.js');

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';

const PROJECT: Project = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'mneia',
  repoUrl: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const storeStub = (items: readonly ContextItem[] = []): ScopedStore =>
  ({
    scope: { workspaceId: WORKSPACE, actorId: ACTOR },
    async getProjectBySlug() {
      return PROJECT;
    },
    async getProject() {
      return PROJECT;
    },
    async listContextItems() {
      return items;
    },
    async searchContextItems() {
      return items;
    },
  }) as unknown as ScopedStore;

let itemCounter = 0;

const storedItem = (title: string, kind: ContextItem['kind']): ContextItem =>
  ({
    id: `55555555-5555-4555-8555-00000000000${++itemCounter}`,
    workspaceId: WORKSPACE,
    projectId: PROJECT.id,
    kind,
    title,
    body: null,
    status: 'active',
    humanConfirmed: false,
    loadBearing: false,
    confidence: 0.9,
    accessScope: 'project',
    assertedBy: ACTOR,
    supersedesId: null,
    supersededById: null,
  }) as unknown as ContextItem;

const turn = (ref: string, text: string) => ({
  ref,
  role: 'user' as const,
  kind: 'text' as const,
  text,
  toolName: null,
  at: '2026-08-08T00:00:00.000Z',
});

const input = (refs: readonly string[], text?: (ref: string) => string): CheckpointProposeWire => ({
  project: 'mneia',
  source: 'claude-code',
  sessionRef: 'session-1',
  trigger: 'task_boundary',
  turns: refs.map((ref) =>
    turn(ref, text === undefined ? `A decision worth keeping about ${ref}` : text(ref)),
  ),
});

const bulky = (ref: string): string =>
  `Turn ${ref}: ${Array.from({ length: 400 }, () => 'settled').join(' ')}`;

const CANDIDATES = JSON.stringify({
  candidates: [
    {
      kind: 'decision',
      title: 'Use Postgres as the single store rather than adding Redis',
      rationale: 'One dependency keeps the BYOC conversation simple.',
      confidence: 0.9,
    },
    { kind: 'decision', title: 'ok', confidence: 0.9, rationale: 'filler' },
  ],
});

const depsWith = (overrides: Partial<Parameters<typeof handleProposeCheckpoint>[2]> = {}) => {
  const seen: { prompts: string[]; usage: unknown[] } = { prompts: [], usage: [] };
  const deps = {
    run: vi.fn(async (request: { system: string; user: string; maxOutputTokens: number }) => {
      seen.prompts.push(request.user);
      return {
        text: CANDIDATES,
        model: 'gpt-5.6-luna',
        attempts: [
          {
            model: 'gpt-5.6-luna',
            outcome: 'succeeded' as const,
            inputTokens: 100,
            outputTokens: 20,
            durationMs: 5,
          },
        ],
      };
    }),
    watermarkFor: vi.fn(async () => null),
    recordUsage: vi.fn(async (usage: unknown) => {
      seen.usage.push(usage);
    }),
    servableContextTokens: 200_000,
    ...overrides,
  };
  return { deps, seen };
};

describe('handleProposeCheckpoint', () => {
  it('proposes candidates and reports the last turn it consumed as the watermark', async () => {
    const { deps } = depsWith();
    const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

    expect(proposal.projectId).toBe(PROJECT.id);
    expect(proposal.consumedTurns).toBe(3);
    expect(proposal.watermark).toBe('c');
    expect(proposal.model).toBe('gpt-5.6-luna');
  });

  it('resumes strictly after the stored watermark', async () => {
    const { deps } = depsWith({ watermarkFor: vi.fn(async () => 'a') });
    const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

    expect(proposal.consumedTurns).toBe(2);
    expect(proposal.watermark).toBe('c');
  });

  it('re-reads the whole window when the watermark is not in this transcript, so no turn is skipped', async () => {
    const { deps } = depsWith({ watermarkFor: vi.fn(async () => 'from-a-rotated-transcript') });
    const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

    expect(proposal.consumedTurns).toBe(3);
  });

  it('does no work and calls no model when the watermark is already at the end', async () => {
    const { deps } = depsWith({ watermarkFor: vi.fn(async () => 'c') });
    const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

    expect(proposal.consumedTurns).toBe(0);
    expect(proposal.candidates).toHaveLength(0);
    expect(proposal.watermark).toBe('c');
    expect(deps.run).not.toHaveBeenCalled();
  });

  it('applies the precision filter, so filler never reaches the review queue', async () => {
    const { deps } = depsWith();
    const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a']), deps);

    expect(proposal.candidates).toHaveLength(1);
    expect(proposal.candidates[0]?.title).toContain('Postgres');
    expect(proposal.rejectedCount).toBe(1);
  });

  it('proposes nothing new when every candidate is already recorded', async () => {
    const { deps } = depsWith();
    const { proposal } = await handleProposeCheckpoint(
      storeStub([
        storedItem('Use Postgres as the single store rather than adding Redis', 'decision'),
      ]),
      input(['a']),
      deps,
    );

    expect(proposal.candidates).toHaveLength(0);
    expect(proposal.duplicateCount).toBe(1);
  });

  it('carries a contradicting candidate through with the item it contradicts attached', async () => {
    const { deps } = depsWith({
      run: vi.fn(async () => ({
        text: JSON.stringify({
          candidates: [
            {
              kind: 'constraint',
              title: 'Rehydration p95 stays under 900ms',
              rationale: 'The network budget turned out larger than assumed.',
              confidence: 0.9,
            },
          ],
        }),
        model: 'gpt-5.6-luna',
        attempts: [],
      })),
    });

    const existing = storedItem('Rehydration p95 stays under 300ms', 'constraint');
    const { proposal } = await handleProposeCheckpoint(
      storeStub([{ ...existing, humanConfirmed: true, loadBearing: true }]),
      input(['a']),
      deps,
    );

    expect(proposal.candidates).toHaveLength(1);
    const [candidate] = proposal.candidates;
    expect(candidate?.supersedesId).toBe(existing.id);
    expect(candidate?.contradiction?.signal).toBe('value_conflict');
    expect(candidate?.contradiction?.matchedHumanConfirmed).toBe(true);
    expect(candidate?.contradiction?.matchedLoadBearing).toBe(true);
    expect(candidate?.contradiction?.reason).toContain('A human decides which one holds');
    expect(proposal.duplicateCount).toBe(0);
  });

  it('refuses an unparseable extraction without proposing anything', async () => {
    const { deps } = depsWith({
      run: vi.fn(async () => ({
        text: 'not json at all',
        model: 'gpt-5.6-luna',
        attempts: [],
      })),
    });

    await expect(handleProposeCheckpoint(storeStub(), input(['a']), deps)).rejects.toThrow(
      ApiRequestError,
    );
  });

  it('records what the model cost even when its output is then rejected', async () => {
    const attempts = [
      {
        model: 'gpt-5.6-luna',
        outcome: 'succeeded' as const,
        inputTokens: 900,
        outputTokens: 40,
        durationMs: 12,
      },
    ];
    const { deps, seen } = depsWith({
      run: vi.fn(async () => ({ text: '{"nope":1}', model: 'gpt-5.6-luna', attempts })),
    });

    await expect(handleProposeCheckpoint(storeStub(), input(['a']), deps)).rejects.toThrow();
    expect(seen.usage).toHaveLength(1);
    expect(deps.recordUsage).toHaveBeenCalledWith({ projectId: PROJECT.id, attempts });
  });

  it('records billable attempts when extraction fails', async () => {
    const attempts = [
      {
        model: 'gpt-5.6-luna',
        outcome: 'failed' as const,
        inputTokens: 900,
        outputTokens: 0,
        durationMs: 12,
      },
    ];
    const { deps, seen } = depsWith({
      run: vi.fn(async () => {
        throw new ExtractionRunError(new Error('the provider reset the connection'), attempts);
      }),
    });

    await expect(handleProposeCheckpoint(storeStub(), input(['a']), deps)).rejects.toThrow(
      /re-read on the next checkpoint/,
    );
    expect(seen.usage).toHaveLength(1);
    expect(deps.recordUsage).toHaveBeenCalledWith({ projectId: PROJECT.id, attempts });
  });

  it('reports an unknown project with a message naming the fix', async () => {
    const missing = {
      ...storeStub(),
      async getProjectBySlug() {
        return null;
      },
    } as unknown as ScopedStore;
    const { deps } = depsWith();

    await expect(handleProposeCheckpoint(missing, input(['a']), deps)).rejects.toThrow(
      /check the slug with mneia status/,
    );
  });

  describe('the lossless invariant', () => {
    const refs = Array.from({ length: 24 }, (_, index) => `t${index}`);

    it('sends every turn to the model when they do not fit one window', async () => {
      const { deps, seen } = depsWith({ servableContextTokens: 20_000 });
      const { proposal } = await handleProposeCheckpoint(storeStub(), input(refs, bulky), deps);

      expect(seen.prompts.length).toBeGreaterThan(1);

      const combined = seen.prompts.join('\n');
      for (const ref of refs) {
        expect(combined).toContain(`Turn ${ref}:`);
      }

      expect(proposal.consumedTurns).toBe(refs.length);
      expect(proposal.watermark).toBe('t23');
      expect(proposal.pendingTurns).toBe(0);
      expect(proposal.incompleteReason).toBeNull();
    });

    it('stops the watermark at the last committed chunk when a later one fails', async () => {
      let call = 0;
      const { deps, seen } = depsWith({
        servableContextTokens: 20_000,
        run: vi.fn(async (request: { system: string; user: string; maxOutputTokens: number }) => {
          call += 1;
          if (call === 2) {
            throw new Error('the provider reset the connection');
          }
          return {
            text: CANDIDATES,
            model: 'gpt-5.6-luna',
            attempts: [
              {
                model: 'gpt-5.6-luna',
                outcome: 'succeeded' as const,
                inputTokens: 100,
                outputTokens: 20,
                durationMs: 5,
              },
            ],
          };
        }),
      });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(refs, bulky), deps);

      expect(call).toBe(2);
      expect(proposal.incompleteReason).toMatch(/chunk 2 of/);
      expect(proposal.consumedTurns).toBeLessThan(refs.length);
      expect(proposal.pendingTurns).toBe(refs.length - proposal.consumedTurns);

      const committed = refs.slice(0, proposal.consumedTurns);
      expect(proposal.watermark).toBe(committed[committed.length - 1]);

      const uncommitted = refs.slice(proposal.consumedTurns);
      const combined = seen.prompts.join('\n');
      expect(uncommitted.length).toBeGreaterThan(0);
      for (const ref of uncommitted) {
        expect(combined).not.toContain(`Turn ${ref}:`);
      }
    });

    it('writes nothing and does not move the watermark when the first chunk fails', async () => {
      const { deps } = depsWith({
        servableContextTokens: 20_000,
        run: vi.fn(async () => {
          throw new Error('the provider reset the connection');
        }),
      });

      await expect(handleProposeCheckpoint(storeStub(), input(refs, bulky), deps)).rejects.toThrow(
        /re-read on the next checkpoint/,
      );
    });

    it('does not move the watermark onto a turn whose later parts were never sent', async () => {
      const giant = Array.from({ length: 60_000 }, () => 'settled').join(' ');
      let call = 0;
      const { deps } = depsWith({
        servableContextTokens: 20_000,
        run: vi.fn(async () => {
          call += 1;
          if (call === 2) {
            throw new Error('the provider reset the connection');
          }
          return {
            text: CANDIDATES,
            model: 'gpt-5.6-luna',
            attempts: [],
          };
        }),
      });

      const { proposal } = await handleProposeCheckpoint(
        storeStub(),
        input(['first', 'giant', 'last'], (ref) => (ref === 'giant' ? giant : `Turn ${ref}`)),
        deps,
      );

      expect(proposal.watermark).toBe('first');
      expect(proposal.watermark).not.toBe('giant');
      expect(proposal.pendingTurns).toBeGreaterThan(0);
    });

    it('refuses when existing item titles leave no room for the transcript', async () => {
      const { deps } = depsWith({ servableContextTokens: 2_000 });

      await expect(handleProposeCheckpoint(storeStub(), input(refs, bulky), deps)).rejects.toThrow(
        /below the 1024 minimum/,
      );
    });
  });
});
