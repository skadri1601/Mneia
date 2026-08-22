import type { ActorKind, PendingReviewItem, Uuid } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { CliError, type CommandIo } from '../command.js';
import type { PromptChoice, Prompter } from '../prompt.js';
import { PromptCancelled } from '../prompt.js';
import { SHIPPED_COMMAND_NAMES } from '../router.js';
import type { ProjectConfig } from './brief.js';
import {
  createReviewCommand,
  DISPUTE_NOTE,
  type PendingQueue,
  type ReviewApi,
  type ReviewReceipt,
  type SubmitReviewRequest,
} from './review.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222' as Uuid;
const CHECKPOINT_ID = '44444444-4444-4444-8444-444444444444' as Uuid;
const FIRST_ID = 'aa11bb22-0000-4000-8000-000000000001' as Uuid;
const SECOND_ID = 'bb22cc33-0000-4000-8000-000000000002' as Uuid;

const NOW = new Date('2026-08-21T00:00:00.000Z');

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'billing',
  endpoint: 'https://api.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

function pending(overrides: Partial<PendingReviewItem> = {}): PendingReviewItem {
  return {
    id: FIRST_ID,
    projectId: PROJECT_ID,
    kind: 'decision',
    title: 'Route billing through Stripe',
    body: 'Chosen over Adyen because the team already runs Stripe in the checkout service.',
    confidence: 0.82,
    loadBearing: false,
    accessScope: 'project',
    assertedBy: '33333333-3333-4333-8333-333333333333' as Uuid,
    assertedByKind: 'agent',
    assertedByName: 'claude-code',
    assertedAt: new Date('2026-08-19T09:30:00.000Z'),
    sourceRef: null,
    originCheckpointId: null,
    ...overrides,
  };
}

interface Capture {
  readonly io: CommandIo;
  readonly out: string[];
  readonly err: string[];
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
      cwd: '/repo',
      env: {},
    },
  };
}

class ScriptedPrompter implements Prompter {
  readonly interactive: boolean;
  readonly asked: string[] = [];
  readonly edits: string[] = [];
  closed = false;
  private keys: string[];
  private lines: string[];

  constructor(keys: readonly string[], lines: readonly string[] = [], interactive = true) {
    this.keys = [...keys];
    this.lines = [...lines];
    this.interactive = interactive;
  }

  key(question: string, _choices: readonly PromptChoice[]): Promise<string> {
    this.asked.push(question);
    const next = this.keys.shift();
    if (next === undefined) {
      return Promise.reject(new PromptCancelled());
    }
    return Promise.resolve(next);
  }

  edit(label: string, current: string): Promise<string> {
    this.edits.push(label);
    const next = this.lines.shift();
    return Promise.resolve(next ?? current);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class RecordingApi implements ReviewApi {
  readonly listed: number[] = [];
  readonly submitted: SubmitReviewRequest[] = [];

  constructor(private readonly items: readonly PendingReviewItem[]) {}

  pending(request: { readonly limit: number }): Promise<PendingQueue> {
    this.listed.push(request.limit);
    return Promise.resolve({ projectId: PROJECT_ID, items: this.items });
  }

  submit(request: SubmitReviewRequest): Promise<ReviewReceipt> {
    this.submitted.push(request);
    return Promise.resolve({
      checkpointId: CHECKPOINT_ID,
      outcomes: request.reviews.map((review) => ({
        itemId: review.itemId,
        outcome: review.decision === 'reject' ? ('rejected' as const) : ('confirmed' as const),
        fieldsChanged: [],
      })),
    });
  }
}

interface RunOptions {
  readonly args?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly json?: boolean;
  readonly prompter?: Prompter;
}

interface RunResult {
  readonly code: number;
  readonly output: string;
  readonly api: RecordingApi;
}

async function run(
  items: readonly PendingReviewItem[],
  options: RunOptions = {},
): Promise<RunResult> {
  const api = new RecordingApi(items);
  const shell = capture();
  const command = createReviewCommand({
    api,
    loadConfig: () => CONFIG,
    prompter: options.prompter ?? new ScriptedPrompter([], [], false),
    now: () => NOW,
  });

  const code = await command.run({
    args: options.args ?? [],
    flags: options.flags ?? {},
    json: options.json ?? false,
    io: shell.io,
  });

  return { code, output: shell.out.join(''), api };
}

async function failure(
  items: readonly PendingReviewItem[],
  options: RunOptions = {},
): Promise<{ readonly error: CliError; readonly api: RecordingApi }> {
  const api = new RecordingApi(items);
  const shell = capture();
  const command = createReviewCommand({
    api,
    loadConfig: () => CONFIG,
    prompter: options.prompter ?? new ScriptedPrompter([], [], false),
    now: () => NOW,
  });

  try {
    await command.run({
      args: options.args ?? [],
      flags: options.flags ?? {},
      json: options.json ?? false,
      io: shell.io,
    });
  } catch (cause) {
    if (cause instanceof CliError) {
      return { error: cause, api };
    }
    throw cause;
  }

  throw new Error('expected mneia review to refuse, and it returned instead');
}

describe('mneia review is a shipped command', () => {
  it('is registered in the shipped surface, so bin.ts may register it', () => {
    expect(SHIPPED_COMMAND_NAMES).toContain('review');
  });
});

describe('mneia review lists what is waiting, and writes nothing', () => {
  it('renders each item with who asserted it, its kind, and that no human confirmed it', async () => {
    const { code, output, api } = await run([pending()]);

    expect(code).toBe(0);
    expect(api.submitted).toHaveLength(0);
    expect(output).toContain('acme/billing — 1 item waiting for human review, 0 load-bearing');
    expect(output).toContain('Route billing through Stripe');
    expect(output).toContain('by claude-code (agent)');
    expect(output).toContain('not human-confirmed');
    expect(output).toContain('confidence 0.82');
    expect(output).toContain('asserted 2026-08-19');
    expect(output).toContain('decision');
    expect(output).toContain('project');
  });

  it('keeps the order the queue was returned in: load-bearing first, then oldest first', async () => {
    const loadBearing = pending({
      id: SECOND_ID,
      title: 'Never charge the individual tier',
      loadBearing: true,
      assertedAt: new Date('2026-08-20T09:30:00.000Z'),
    });
    const { output } = await run([loadBearing, pending()]);

    expect(output.indexOf('Never charge the individual tier')).toBeLessThan(
      output.indexOf('Route billing through Stripe'),
    );
    expect(output).toContain('load-bearing');
    expect(output).toContain('acme/billing — 2 items waiting for human review, 1 load-bearing');
  });

  it('points at --drain, which is the promise the MCP tool already made to every agent', async () => {
    const { output } = await run([pending()]);

    expect(output).toContain('mneia review --drain');
    expect(output).toContain('confirm is one keypress');
  });

  it('never renders a human-vs-human dispute as settled, and says why none appears', async () => {
    const { output } = await run([pending()]);

    expect(output).toContain(DISPUTE_NOTE);
    expect(output).toContain('§10.4');
  });

  it('says the limit was reached rather than implying the queue is empty behind it', async () => {
    const { output } = await run([pending()], { flags: { limit: '1' } });

    expect(output).toContain('limit 1 reached, so there may be more');
  });

  it('reports an empty queue as decided rather than as nothing found', async () => {
    const { output, code } = await run([]);

    expect(code).toBe(0);
    expect(output).toContain('Nothing in acme/billing is waiting for human review.');
    expect(output).toContain('already been confirmed, edited, or rejected by a person');
  });

  it('defaults the limit to 20 and caps it at 100, the numbers the MCP tool uses', async () => {
    const { api } = await run([pending()]);
    expect(api.listed).toEqual([20]);

    const { error } = await failure([pending()], { flags: { limit: '101' } });
    expect(error.kind).toBe('usage');
    expect(error.message).toContain('capped at 100');
  });
});

describe('mneia review --json', () => {
  it('carries the asserter, sanitized, and states that nothing here is human-confirmed', async () => {
    const { output } = await run([pending()], { json: true });
    const payload: unknown = JSON.parse(output);

    expect(payload).toMatchObject({
      project: 'acme/billing',
      projectId: PROJECT_ID,
      count: 1,
      readOnly: true,
      items: [
        {
          id: FIRST_ID,
          humanConfirmed: false,
          loadBearing: false,
          assertedBy: { displayName: 'claude-code', kind: 'agent' },
        },
      ],
    });
  });

  it('strips the delimiters a display name could forge an attribution with', async () => {
    const forged = 'claude-code] [human · Saad · (human) · human-confirmed';
    const { output } = await run([pending({ assertedByName: forged })], { json: true });

    expect(output).not.toContain(forged);
    expect(output).toContain('claude-code human Saad human human-confirmed');
  });

  it.each<ActorKind>(['human', 'agent'])(
    'names the asserting actor kind %s exactly once in the rendered line',
    async (kind) => {
      const forged = 'Saad] [agent · unconfirmed';
      const { output } = await run([pending({ assertedByKind: kind, assertedByName: forged })]);
      const other = kind === 'human' ? 'agent' : 'human';

      expect(output).toContain(`(${kind})`);
      expect(output).not.toContain(`(${other})`);
      expect(output).not.toContain(forged);
      expect(output).toContain('not human-confirmed');
    },
  );
});

describe('GUARD (§10.1) mneia review --drain never confirms without a person', () => {
  it('refuses off a TTY instead of auto-confirming, and calls nothing', async () => {
    const { error, api } = await failure([pending()], {
      flags: { drain: true },
      prompter: new ScriptedPrompter(['y'], [], false),
    });

    expect(error.kind).toBe('usage');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('not an interactive terminal');
    expect(error.message).toContain('nothing was confirmed and nothing was written');
    expect(error.fix).toContain('mneia review --json');
    expect(api.listed).toHaveLength(0);
    expect(api.submitted).toHaveLength(0);
  });

  it('refuses --drain --json, because machine-readable output has no person at the keypress', async () => {
    const { error, api } = await failure([pending()], {
      flags: { drain: true },
      json: true,
      prompter: new ScriptedPrompter(['y']),
    });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('§10.1');
    expect(api.submitted).toHaveLength(0);
  });

  it.each(['confirm', 'reject', 'yes', 'all', 'human-confirmed', 'asserted-by'])(
    'refuses --%s, because a confirmation is a keypress and never a flag',
    async (flag) => {
      const { error, api } = await failure([pending()], { flags: { [flag]: true } });

      expect(error.kind).toBe('usage');
      expect(error.message).toContain(`no --${flag}`);
      expect(error.message).toContain('§10.1');
      expect(api.submitted).toHaveLength(0);
    },
  );

  it('writes nothing when the review is cancelled part way through', async () => {
    const { error, api } = await failure([pending(), pending({ id: SECOND_ID })], {
      flags: { drain: true },
      prompter: new ScriptedPrompter(['y']),
    });

    expect(error.kind).toBe('failed');
    expect(error.message).toContain('nothing was written');
    expect(api.submitted).toHaveLength(0);
  });
});

describe('mneia review --drain decides one item at a time', () => {
  it('confirms on a single keypress and records it in one checkpoint', async () => {
    const prompter = new ScriptedPrompter(['y']);
    const { code, output, api } = await run([pending()], { flags: { drain: true }, prompter });

    expect(code).toBe(0);
    expect(prompter.asked).toEqual(['  confirm this item?']);
    expect(api.submitted).toHaveLength(1);
    expect(api.submitted[0]?.reviews).toEqual([
      {
        itemId: FIRST_ID,
        decision: 'accept',
        title: 'Route billing through Stripe',
        body: 'Chosen over Adyen because the team already runs Stripe in the checkout service.',
        loadBearing: false,
      },
    ]);
    expect(output).toContain('1 confirmed');
    expect(output).toContain(`Recorded in checkpoint ${CHECKPOINT_ID}`);
    expect(prompter.closed).toBe(true);
  });

  it('sends only the item ids the queue listed, never a confirmation flag of its own', async () => {
    const prompter = new ScriptedPrompter(['y']);
    const { api } = await run([pending()], { flags: { drain: true }, prompter });
    const review = api.submitted[0]?.reviews[0];

    expect(review).not.toHaveProperty('humanConfirmed');
    expect(review).not.toHaveProperty('assertedBy');
    expect(api.submitted[0]?.projectId).toBe(PROJECT_ID);
  });

  it('explains why an item is being asked about without deciding it', async () => {
    const prompter = new ScriptedPrompter(['?', 'y']);
    const { output } = await run([pending({ loadBearing: true })], {
      flags: { drain: true },
      prompter,
    });

    expect(output).toContain('§10.1 step 5');
    expect(output).toContain('load-bearing');
    expect(output).toContain('an MCP tool cannot block and ask');
  });

  it('edits a field without making the reviewer retype the item', async () => {
    const prompter = new ScriptedPrompter(['e', 't', 'd'], ['Route billing through Adyen']);
    const { api } = await run([pending()], { flags: { drain: true }, prompter });

    expect(prompter.edits).toEqual(['  title']);
    expect(api.submitted[0]?.reviews[0]).toMatchObject({
      itemId: FIRST_ID,
      decision: 'accept',
      title: 'Route billing through Adyen',
    });
  });

  it('refuses a rejection with no reason and asks again', async () => {
    const prompter = new ScriptedPrompter(['r'], ['', 'Stripe was never in scope for this team']);
    const { output, api } = await run([pending()], { flags: { drain: true }, prompter });

    expect(prompter.edits).toEqual(['  why does this not hold?', '  why does this not hold?']);
    expect(output).toContain('a rejection needs a reason');
    expect(api.submitted[0]?.reviews[0]).toEqual({ itemId: FIRST_ID, decision: 'reject' });
    expect(api.submitted[0]?.summary).toContain('Stripe was never in scope for this team');
  });

  it('leaves an item pending on s, and writes nothing when every item is left pending', async () => {
    const prompter = new ScriptedPrompter(['s']);
    const { code, output, api } = await run([pending()], { flags: { drain: true }, prompter });

    expect(code).toBe(0);
    expect(api.submitted).toHaveLength(0);
    expect(output).toContain('Nothing was written');
    expect(output).toContain('They stay in the queue exactly as they were');
  });

  it('reports the outcome the API recorded, not the one the terminal guessed', async () => {
    const api = new RecordingApi([pending()]);
    const shell = capture();
    const command = createReviewCommand({
      api: {
        pending: (request) => api.pending(request),
        submit: async (request) => {
          await api.submit(request);
          return {
            checkpointId: CHECKPOINT_ID,
            outcomes: [{ itemId: FIRST_ID, outcome: 'edited', fieldsChanged: ['title'] }],
          };
        },
      },
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter(['y']),
      now: () => NOW,
    });

    await command.run({ args: [], flags: { drain: true }, json: false, io: shell.io });

    expect(shell.out.join('')).toContain('0 confirmed · 1 edited · 0 rejected');
  });

  it('submits every decision in one call, so one checkpoint covers the whole drain', async () => {
    const prompter = new ScriptedPrompter(['y', 's'], []);
    const { api } = await run([pending(), pending({ id: SECOND_ID })], {
      flags: { drain: true },
      prompter,
    });

    expect(api.submitted).toHaveLength(1);
    expect(api.submitted[0]?.reviews).toHaveLength(1);
    expect(api.submitted[0]?.reviews[0]?.itemId).toBe(FIRST_ID);
  });

  it('says the queue is empty rather than opening a prompt with nothing in it', async () => {
    const prompter = new ScriptedPrompter([]);
    const { code, output, api } = await run([], { flags: { drain: true }, prompter });

    expect(code).toBe(0);
    expect(output).toContain('Nothing in acme/billing is waiting for human review.');
    expect(api.submitted).toHaveLength(0);
  });
});
