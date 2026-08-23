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
  fromStart: false,
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
    quota: vi.fn(async () => ({ allowed: true, source: 'allowance' }) as const),
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
    primaryModel: 'gpt-5.6-luna',
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

  describe('an upload that does not reach back to the watermark', () => {
    const unreachable = () => vi.fn(async () => 'a-turn-we-were-not-sent');

    it('still extracts it, because losing the turns costs more than reading them twice', async () => {
      const { deps } = depsWith({ watermarkFor: unreachable() });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

      expect(deps.run).toHaveBeenCalled();
      expect(proposal.candidates.length).toBeGreaterThan(0);
    });

    it('leaves the watermark where it was, so it can never walk backwards', async () => {
      const { deps } = depsWith({ watermarkFor: unreachable() });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

      expect(proposal.watermark).toBe('a-turn-we-were-not-sent');
      expect(proposal.watermark).not.toBe('c');
    });

    it('reports every sent turn as still pending, and says why', async () => {
      const { deps } = depsWith({ watermarkFor: unreachable() });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

      expect(proposal.pendingTurns).toBe(3);
      expect(proposal.coverage?.pendingTurns).toBe(3);
      expect(proposal.incompleteReason).toMatch(/does not contain watermark/);
    });

    it('does not hold the watermark when the probe uploads no turns at all', async () => {
      // turnsSince cannot find a watermark in an empty array, so every watermark probe
      // reports resolved: false. Treating that as a held watermark would be harmless but
      // would put a failure message on a request that succeeded.
      const { deps } = depsWith({ watermarkFor: unreachable() });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input([]), deps);

      expect(proposal.watermark).toBe('a-turn-we-were-not-sent');
      expect(proposal.incompleteReason).toBeNull();
      expect(deps.run).not.toHaveBeenCalled();
    });
  });

  it('re-reads the whole window when the client declares a rotated transcript, so no turn is skipped', async () => {
    // The original property, kept for the case it was actually written for. A rotated
    // transcript genuinely no longer holds the watermark, and that is permanent for the
    // session, so refusing would mean it could never checkpoint again.
    const { deps } = depsWith({ watermarkFor: vi.fn(async () => 'from-a-rotated-transcript') });
    const { proposal } = await handleProposeCheckpoint(
      storeStub(),
      { ...input(['a', 'b', 'c']), fromStart: true },
      deps,
    );

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

  describe('the quota gate', () => {
    const exhausted = () =>
      vi.fn(async () => ({
        allowed: false as const,
        code: 'allowance_exhausted',
        message: 'this workspace has used 10 of its 10 checkpoints for the period',
      }));

    it('refuses before calling the model, so a denial costs no inference', async () => {
      const { deps } = depsWith({ quota: exhausted() });

      await expect(
        handleProposeCheckpoint(storeStub(), input(['a', 'b']), deps),
      ).rejects.toMatchObject({ code: 'forbidden' });

      expect(deps.run).not.toHaveBeenCalled();
      expect(deps.recordUsage).not.toHaveBeenCalled();
    });

    it('carries the refusal message through, so the caller is told what to do', async () => {
      const { deps } = depsWith({ quota: exhausted() });

      await expect(handleProposeCheckpoint(storeStub(), input(['a']), deps)).rejects.toThrow(
        'used 10 of its 10',
      );
    });

    it('does not consult the quota when there is nothing to extract', async () => {
      const { deps } = depsWith({ watermarkFor: vi.fn(async () => 'c') });

      await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c']), deps);

      expect(deps.quota).not.toHaveBeenCalled();
    });

    it('proceeds when the workspace is unmetered', async () => {
      const { deps } = depsWith();

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a']), deps);

      expect(deps.quota).toHaveBeenCalledTimes(1);
      expect(proposal.consumedTurns).toBe(1);
    });
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
    // toMatchObject, not toHaveBeenCalledWith: the record now also carries the turn count,
    // the priced cost and any wallet debit, and this test is about the attempts surviving
    // a rejected or failed extraction, not about the shape of the whole record.
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT.id, attempts }),
    );
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
    // toMatchObject, not toHaveBeenCalledWith: the record now also carries the turn count,
    // the priced cost and any wallet debit, and this test is about the attempts surviving
    // a rejected or failed extraction, not about the shape of the whole record.
    expect(deps.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT.id, attempts }),
    );
  });

  describe('the coverage carried to §17', () => {
    const refs = Array.from({ length: 24 }, (_, index) => `t${index}`);
    const PROVIDER_SECRET = 'candidates: [{ title: a real decision from the transcript }]';

    it('reports a clean run as fully covered, with no failure code', async () => {
      const { deps } = depsWith();
      const { proposal } = await handleProposeCheckpoint(storeStub(), input(['a', 'b']), deps);

      expect(proposal.coverage).toEqual({
        droppedTurns: 0,
        splitTurns: 0,
        pendingTurns: 0,
        consumedTurns: 2,
        incompleteCode: null,
      });
    });

    it('counts turns the chunker had to split, which nothing recorded before', async () => {
      const { deps } = depsWith({ servableContextTokens: 20_000 });
      const { proposal } = await handleProposeCheckpoint(
        storeStub(),
        input(['solo'], () => `Turn solo: ${Array.from({ length: 40_000 }, () => 'x').join(' ')}`),
        deps,
      );

      expect(proposal.coverage?.splitTurns).toBeGreaterThan(0);
    });

    it('records a provider failure as a code, never as the provider message', async () => {
      let call = 0;
      const { deps } = depsWith({
        servableContextTokens: 20_000,
        run: vi.fn(async () => {
          call += 1;
          if (call === 2) {
            throw new Error(PROVIDER_SECRET);
          }
          return {
            text: CANDIDATES,
            model: 'gpt-5.6-luna',
            attempts: [],
          };
        }),
      });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(refs, bulky), deps);

      expect(proposal.coverage?.incompleteCode).toBe('provider_failed');
      expect(JSON.stringify(proposal.coverage)).not.toContain(PROVIDER_SECRET);
      expect(proposal.incompleteReason).toContain(PROVIDER_SECRET);
    });

    it('records unusable model output as a code, never as the output', async () => {
      let call = 0;
      const { deps } = depsWith({
        servableContextTokens: 20_000,
        run: vi.fn(async () => {
          call += 1;
          return {
            text: call === 2 ? `{"broken": "${PROVIDER_SECRET}"` : CANDIDATES,
            model: 'gpt-5.6-luna',
            attempts: [],
          };
        }),
      });

      const { proposal } = await handleProposeCheckpoint(storeStub(), input(refs, bulky), deps);

      expect(proposal.coverage?.incompleteCode).toBe('invalid_output');
      expect(JSON.stringify(proposal.coverage)).not.toContain(PROVIDER_SECRET);
    });

    it('agrees with the top-level counts, so the two cannot drift', async () => {
      const { deps } = depsWith({ servableContextTokens: 20_000 });
      const { proposal } = await handleProposeCheckpoint(storeStub(), input(refs, bulky), deps);

      expect(proposal.coverage?.consumedTurns).toBe(proposal.consumedTurns);
      expect(proposal.coverage?.pendingTurns).toBe(proposal.pendingTurns);
    });
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

describe('what each extraction request is told about the session', () => {
  it('shows the model the summary the person wrote, instead of only storing it', async () => {
    const { deps, seen } = depsWith();

    await handleProposeCheckpoint(
      storeStub(),
      { ...input(['a', 'b']), summary: 'migrating the ledger writes to the v2 schema' },
      deps,
    );

    expect(seen.prompts).toHaveLength(1);
    expect(seen.prompts[0]).toContain('migrating the ledger writes to the v2 schema');
  });

  it('sends no summary section when the caller stated none', async () => {
    const { deps, seen } = depsWith();

    await handleProposeCheckpoint(storeStub(), input(['a']), deps);

    expect(seen.prompts[0]).not.toContain('## What this session was about');
  });

  // A session too large for one request is split, and before this each chunk was judged as
  // a stranger: a decision opened in chunk 1 and settled in chunk 3 was invisible to both.
  it('carries earlier chunks findings into later chunks of the same session', async () => {
    const { deps, seen } = depsWith({ servableContextTokens: 20_000 });

    const fat = (ref: string) =>
      `Turn ${ref}: ${Array.from({ length: 6_000 }, () => 'settled').join(' ')}`;

    await handleProposeCheckpoint(storeStub(), input(['a', 'b', 'c', 'd'], fat), deps);

    expect(seen.prompts.length).toBeGreaterThan(1);
    expect(seen.prompts[0]).not.toContain('## Already proposed from earlier in this session');

    const later = seen.prompts.slice(1);
    expect(later.every((prompt) => prompt.includes('## Already proposed from earlier'))).toBe(true);
  });
});
