import type { TelemetryEvent, Uuid } from '@mneia/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { CliError, type CommandIo } from '../command.js';
import type { PromptChoice, Prompter } from '../prompt.js';
import { PromptCancelled } from '../prompt.js';
import type { ProjectConfig } from './brief.js';
import {
  type CheckpointApi,
  type CheckpointCandidate,
  type CheckpointProposal,
  type CheckpointReceipt,
  type CommitRequest,
  createCheckpointCommand,
  type DiscoveredSession,
  emitReviewEvents,
  needsHuman,
  type ProposeRequest,
  partitionCandidates,
  type ReviewedCandidate,
  readTrigger,
  renderCandidate,
  reviewCandidates,
  type SessionDiscovery,
  whyAsked,
} from './checkpoint.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111' as Uuid;
const PROJECT_ID = '22222222-2222-4222-8222-222222222222' as Uuid;
const ACTOR_ID = '33333333-3333-4333-8333-333333333333' as Uuid;
const CHECKPOINT_ID = '44444444-4444-4444-8444-444444444444' as Uuid;
const EXISTING_ID = '55555555-5555-4555-8555-555555555555' as Uuid;

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'billing',
  endpoint: 'https://api.mneia.dev',
} as ProjectConfig;

function candidate(overrides: Partial<CheckpointCandidate> = {}): CheckpointCandidate {
  return {
    index: 0,
    kind: 'decision',
    title: 'Use Stripe for billing',
    body: null,
    confidence: 0.8,
    loadBearing: false,
    accessScope: 'project',
    supersedes: null,
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

function proposalOf(candidates: readonly CheckpointCandidate[]): CheckpointProposal {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    sessionId: null,
    source: 'claude-code',
    sourceSessionRef: 'session-newest',
    watermark: null,
    candidates,
    pendingTurns: 0,
    incompleteReason: null,
    droppedBeforeUpload: 0,
  };
}

function receiptFor(candidates: readonly CheckpointCandidate[]): CheckpointReceipt {
  return {
    checkpointId: CHECKPOINT_ID,
    items: candidates.map((entry, position) => ({
      index: entry.index,
      itemId: `66666666-6666-4666-8666-66666666666${position}` as Uuid,
      action: 'created' as const,
    })),
  };
}

const NEWEST_SESSION: DiscoveredSession = {
  source: 'claude-code',
  sessionRef: 'session-newest',
  lastActivityAt: new Date('2026-08-20T16:41:00.000Z'),
};

const OLDER_SESSION: DiscoveredSession = {
  source: 'cursor',
  sessionRef: 'session-older',
  lastActivityAt: new Date('2026-08-19T09:10:00.000Z'),
};

class FakeApi implements CheckpointApi {
  readonly commits: CommitRequest[] = [];
  readonly proposals: ProposeRequest[] = [];
  sessions: readonly DiscoveredSession[] = [NEWEST_SESSION];
  failOn: string | null = null;
  discoveries = 0;

  constructor(private readonly proposal: CheckpointProposal) {}

  discover(): Promise<SessionDiscovery> {
    this.discoveries += 1;
    return Promise.resolve({ sessions: this.sessions, blocked: [] });
  }

  propose(request: ProposeRequest): Promise<CheckpointProposal> {
    this.proposals.push(request);
    if (this.failOn !== null && request.sessionRef === this.failOn) {
      return Promise.reject(new CliError('network', 'the API could not be reached', 'retry'));
    }
    return Promise.resolve(this.proposal);
  }

  commit(request: CommitRequest): Promise<CheckpointReceipt> {
    this.commits.push(request);
    return Promise.resolve(receiptFor(this.proposal.candidates));
  }
}

describe('needsHuman', () => {
  it('leaves an ordinary candidate alone', () => {
    expect(needsHuman(candidate())).toBe(false);
  });

  it('asks about a load-bearing candidate', () => {
    expect(needsHuman(candidate({ loadBearing: true }))).toBe(true);
  });

  it('asks about a candidate that supersedes an existing item', () => {
    expect(
      needsHuman(
        candidate({
          supersedes: {
            id: EXISTING_ID,
            title: 'Use Adyen',
            humanConfirmed: true,
            loadBearing: true,
          },
        }),
      ),
    ).toBe(true);
  });
});

describe('partitionCandidates', () => {
  it('prompts only for what needs a human', () => {
    const items = [
      candidate({ index: 0 }),
      candidate({ index: 1, loadBearing: true }),
      candidate({ index: 2 }),
      candidate({
        index: 3,
        supersedes: {
          id: EXISTING_ID,
          title: 'Use Adyen',
          humanConfirmed: false,
          loadBearing: false,
        },
      }),
    ];

    const { automatic, review } = partitionCandidates(items);

    expect(automatic.map((entry) => entry.index)).toEqual([0, 2]);
    expect(review.map((entry) => entry.index)).toEqual([1, 3]);
  });
});

describe('whyAsked', () => {
  it('cites §10.1 step 5 for a load-bearing item', () => {
    expect(whyAsked(candidate({ loadBearing: true }))).toContain('§10.1 step 5');
  });

  it('names the human-confirmed item it would replace', () => {
    const reason = whyAsked(
      candidate({
        supersedes: {
          id: EXISTING_ID,
          title: 'Use Adyen',
          humanConfirmed: true,
          loadBearing: true,
        },
      }),
    );
    expect(reason).toContain('Use Adyen');
    expect(reason).toContain('never supersedes a human-confirmed item');
  });
});

describe('renderCandidate', () => {
  it('carries meaning in text, not colour', () => {
    const text = renderCandidate(candidate({ loadBearing: true }), 1, 3);
    expect(text).toContain('(1/3)');
    expect(text).toContain('load-bearing');
    expect(text).toContain('decision');
  });
});

describe('reviewCandidates', () => {
  let sink: Capture;

  beforeEach(() => {
    sink = capture();
  });

  it('confirms on a single keypress', async () => {
    const prompter = new ScriptedPrompter(['y']);
    const reviewed = await reviewCandidates([candidate({ loadBearing: true })], prompter, sink.io);

    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.decision).toBe('confirmed');
    expect(reviewed[0]?.fieldsChanged).toEqual([]);
    expect(prompter.asked).toHaveLength(1);
  });

  it('rejects on a single keypress', async () => {
    const prompter = new ScriptedPrompter(['r']);
    const reviewed = await reviewCandidates([candidate({ loadBearing: true })], prompter, sink.io);

    expect(reviewed[0]?.decision).toBe('rejected');
  });

  it('explains without consuming the decision', async () => {
    const prompter = new ScriptedPrompter(['?', 'y']);
    const reviewed = await reviewCandidates([candidate({ loadBearing: true })], prompter, sink.io);

    expect(reviewed[0]?.decision).toBe('confirmed');
    expect(sink.out.join('')).toContain('§10.1 step 5');
  });

  it('edits a single field without retyping the rest', async () => {
    const prompter = new ScriptedPrompter(['e', 't', 'd'], ['Use Stripe Connect for billing']);
    const original = candidate({ loadBearing: true, body: 'Chosen for payout support.' });
    const reviewed = await reviewCandidates([original], prompter, sink.io);

    expect(reviewed[0]?.decision).toBe('edited');
    expect(reviewed[0]?.title).toBe('Use Stripe Connect for billing');
    expect(reviewed[0]?.body).toBe('Chosen for payout support.');
    expect(reviewed[0]?.fieldsChanged).toEqual(['title']);
    expect(prompter.edits).toEqual(['  title']);
  });

  it('records a load-bearing toggle as an edit', async () => {
    const prompter = new ScriptedPrompter(['e', 'l', 'd']);
    const reviewed = await reviewCandidates([candidate({ loadBearing: true })], prompter, sink.io);

    expect(reviewed[0]?.decision).toBe('edited');
    expect(reviewed[0]?.loadBearing).toBe(false);
    expect(reviewed[0]?.fieldsChanged).toEqual(['loadBearing']);
  });

  it('treats an edit that changed nothing as a plain confirmation', async () => {
    const prompter = new ScriptedPrompter(['e', 'd']);
    const reviewed = await reviewCandidates([candidate({ loadBearing: true })], prompter, sink.io);

    expect(reviewed[0]?.decision).toBe('confirmed');
    expect(reviewed[0]?.fieldsChanged).toEqual([]);
  });
});

describe('emitReviewEvents', () => {
  it('emits the §17 confirm, edit, and reject events', async () => {
    const events: TelemetryEvent[] = [];
    const telemetry = {
      emit: (event: TelemetryEvent) => {
        events.push(event);
        return Promise.resolve();
      },
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };

    const candidates = [
      candidate({ index: 0, loadBearing: true }),
      candidate({ index: 1, loadBearing: true }),
      candidate({ index: 2, loadBearing: true }),
    ];

    const reviewed: ReviewedCandidate[] = [
      {
        candidate: candidates[0] as CheckpointCandidate,
        decision: 'confirmed',
        title: 'a',
        body: null,
        loadBearing: true,
        fieldsChanged: [],
      },
      {
        candidate: candidates[1] as CheckpointCandidate,
        decision: 'edited',
        title: 'b',
        body: null,
        loadBearing: true,
        fieldsChanged: ['title'],
      },
      {
        candidate: candidates[2] as CheckpointCandidate,
        decision: 'rejected',
        title: 'c',
        body: null,
        loadBearing: true,
        fieldsChanged: [],
      },
    ];

    const emitted = await emitReviewEvents(telemetry, {
      proposal: proposalOf(candidates),
      receipt: receiptFor(candidates),
      reviewed,
      occurredAt: new Date('2026-08-03T00:00:00.000Z'),
    });

    expect(emitted).toBe(3);
    expect(events.map((event) => event.name)).toEqual([
      'checkpoint.item_confirmed',
      'checkpoint.item_edited',
      'checkpoint.item_rejected',
    ]);

    const edited = events[1];
    expect(edited?.name === 'checkpoint.item_edited' && edited.fieldsChanged).toEqual(['title']);
    for (const event of events) {
      expect(event.workspaceId).toBe(WORKSPACE_ID);
      expect(event.projectId).toBe(PROJECT_ID);
      expect(event.actorId).toBe(ACTOR_ID);
    }
  });

  it('does not fail the checkpoint when a sink throws', async () => {
    const telemetry = {
      emit: () => Promise.reject(new Error('sink down')),
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const candidates = [candidate({ index: 0, loadBearing: true })];

    await expect(
      emitReviewEvents(telemetry, {
        proposal: proposalOf(candidates),
        receipt: receiptFor(candidates),
        reviewed: [
          {
            candidate: candidates[0] as CheckpointCandidate,
            decision: 'confirmed',
            title: 'a',
            body: null,
            loadBearing: true,
            fieldsChanged: [],
          },
        ],
        occurredAt: new Date(),
      }),
    ).resolves.toBe(1);
  });
});

describe('readTrigger', () => {
  it('defaults to task_boundary', () => {
    expect(readTrigger({})).toBe('task_boundary');
  });

  it('accepts a known trigger', () => {
    expect(readTrigger({ trigger: 'day_boundary' })).toBe('day_boundary');
  });

  it('names the valid triggers when given a bad one', () => {
    expect(() => readTrigger({ trigger: 'whenever' })).toThrow(/task_boundary/);
  });
});

describe('mneia checkpoint', () => {
  it('records candidates that need no human without prompting at all', async () => {
    const proposal = proposalOf([candidate({ index: 0 }), candidate({ index: 1 })]);
    const api = new FakeApi(proposal);
    const prompter = new ScriptedPrompter([]);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter,
    });

    const code = await command.run({ args: [], flags: {}, json: false, io: sink.io });

    expect(code).toBe(0);
    expect(prompter.asked).toEqual([]);
    expect(api.commits[0]?.automatic).toHaveLength(2);
    expect(api.commits[0]?.reviewed).toHaveLength(0);
    expect(sink.out.join('')).toContain('2 items recorded without asking');
  });

  it('says when turns were left unread, so a partial run is not mistaken for a whole one', async () => {
    const proposal = {
      ...proposalOf([candidate({ index: 0 })]),
      pendingTurns: 412,
      incompleteReason: 'chunk 2 of 3 did not complete',
    };
    const api = new FakeApi(proposal);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    await command.run({ args: [], flags: {}, json: false, io: sink.io });

    const errors = sink.err.join('');
    expect(errors).toContain('412 turns were not read');
    expect(errors).toContain('run mneia checkpoint again');
    expect(errors).toContain('nothing was skipped');
    expect(errors).toContain('chunk 2 of 3');
  });

  it('marks JSON output incomplete when chunks were left unread, so an agent knows to run again', async () => {
    const proposal = {
      ...proposalOf([candidate({ index: 0 })]),
      pendingTurns: 412,
      incompleteReason: 'chunk 2 of 3 did not complete',
    };
    const api = new FakeApi(proposal);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    await command.run({ args: [], flags: {}, json: true, io: sink.io });

    const payload = JSON.parse(sink.out.join(''));
    expect(payload.complete).toBe(false);
    expect(payload.pendingTurns).toBe(412);
    expect(payload.incompleteReason).toBe('chunk 2 of 3 did not complete');
  });

  it('marks JSON output complete only when nothing was left behind', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    await command.run({ args: [], flags: {}, json: true, io: sink.io });

    const payload = JSON.parse(sink.out.join(''));
    expect(payload.complete).toBe(true);
    expect(payload.pendingTurns).toBe(0);
    expect(payload.droppedBeforeUpload).toBe(0);
  });

  it('reports a turn dropped before upload as a defect, because the client no longer caps', async () => {
    const api = new FakeApi({
      ...proposalOf([candidate({ index: 0 })]),
      droppedBeforeUpload: 428,
    });
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    await command.run({ args: [], flags: {}, json: false, io: sink.io });

    const errors = sink.err.join('');
    expect(errors).toContain('expected 0');
    expect(errors).toContain('428 were');
    expect(errors).toContain('defect in mneia');
    expect(errors).not.toContain('undefined');
  });

  it('stays quiet about pending turns when the whole session was read', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    await command.run({ args: [], flags: {}, json: false, io: sink.io });

    expect(sink.err.join('')).not.toContain('were not read');
  });

  it('refuses to confirm anything when there is no interactive terminal', async () => {
    const proposal = proposalOf([
      candidate({ index: 0 }),
      candidate({ index: 1, loadBearing: true }),
    ]);
    const api = new FakeApi(proposal);
    const prompter = new ScriptedPrompter([], [], false);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter,
    });

    const code = await command.run({ args: [], flags: {}, json: false, io: sink.io });

    expect(code).toBe(1);
    expect(prompter.asked).toEqual([]);
    expect(api.commits).toHaveLength(1);
    expect(api.commits[0]?.reviewed).toHaveLength(0);
    expect(api.commits[0]?.automatic).toHaveLength(1);

    const text = sink.out.join('');
    expect(text).toContain('PENDING HUMAN CONFIRMATION');
    expect(text).toContain('not an interactive terminal');
  });

  it('never prompts under --json, and reports what is pending instead', async () => {
    const proposal = proposalOf([candidate({ index: 0, loadBearing: true })]);
    const api = new FakeApi(proposal);
    const prompter = new ScriptedPrompter(['y']);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter,
    });

    const code = await command.run({ args: [], flags: {}, json: true, io: sink.io });

    expect(code).toBe(1);
    expect(prompter.asked).toEqual([]);

    const payload = JSON.parse(sink.out.join('')) as {
      pendingCount: number;
      checkpointId: string | null;
      pending: readonly { reason: string }[];
    };
    expect(payload.pendingCount).toBe(1);
    expect(payload.checkpointId).toBeNull();
    expect(payload.pending[0]?.reason).toContain('§10.1 step 5');
  });

  it('commits the reviewed decisions and reports the split', async () => {
    const proposal = proposalOf([
      candidate({ index: 0 }),
      candidate({ index: 1, loadBearing: true }),
      candidate({ index: 2, loadBearing: true }),
    ]);
    const api = new FakeApi(proposal);
    const prompter = new ScriptedPrompter(['y', 'r']);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter,
      now: () => new Date('2026-08-03T00:00:00.000Z'),
    });

    const code = await command.run({
      args: [],
      flags: { message: 'wired up billing' },
      json: false,
      io: sink.io,
    });

    expect(code).toBe(0);
    expect(api.commits[0]?.summary).toBe('wired up billing');
    expect(api.commits[0]?.reviewed.map((entry) => entry.decision)).toEqual([
      'confirmed',
      'rejected',
    ]);
    expect(prompter.closed).toBe(true);

    const text = sink.out.join('');
    expect(text).toContain('1 item recorded without asking');
    expect(text).toContain('1 confirmed');
    expect(text).toContain('1 rejected');
  });

  it('records nothing when the review is cancelled part way', async () => {
    const proposal = proposalOf([
      candidate({ index: 0, loadBearing: true }),
      candidate({ index: 1, loadBearing: true }),
    ]);
    const api = new FakeApi(proposal);
    const prompter = new ScriptedPrompter(['y']);
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter,
    });

    await expect(
      command.run({ args: [], flags: {}, json: false, io: sink.io }),
    ).rejects.toBeInstanceOf(CliError);

    expect(api.commits).toHaveLength(0);
  });

  it('says so plainly when there is nothing to checkpoint', async () => {
    const api = new FakeApi(proposalOf([]));
    const sink = capture();

    const command = createCheckpointCommand({
      api,
      loadConfig: () => CONFIG,
      prompter: new ScriptedPrompter([]),
    });

    const code = await command.run({ args: [], flags: {}, json: false, io: sink.io });

    expect(code).toBe(0);
    expect(api.commits).toHaveLength(0);
    expect(sink.out.join('')).toContain('Nothing to checkpoint');
  });
});

describe('mneia checkpoint across sessions', () => {
  const commandFor = (api: FakeApi, prompter = new ScriptedPrompter([])) =>
    createCheckpointCommand({ api, loadConfig: () => CONFIG, prompter });

  it('reads every discovered session by default, not just the newest', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    const code = await commandFor(api).run({ args: [], flags: {}, json: false, io: sink.io });

    expect(code).toBe(0);
    expect(api.proposals.map((request) => request.sessionRef)).toEqual([
      'session-newest',
      'session-older',
    ]);
  });

  it('no longer points at a flag for behaviour it now has by default', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    await commandFor(api).run({ args: [], flags: {}, json: false, io: sink.io });

    expect(sink.err.join('')).not.toContain('did not read');
  });

  it('reads the session you name', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    await commandFor(api).run({
      args: [],
      flags: { session: 'older' },
      json: false,
      io: sink.io,
    });

    expect(api.proposals.map((request) => request.sessionRef)).toEqual(['session-older']);
  });

  it('does not enumerate any harness when --source names the one that ended', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    const code = await commandFor(api).run({
      args: [],
      flags: { session: 'session-older', source: 'claude-code' },
      json: false,
      io: sink.io,
    });

    expect(code).toBe(0);
    expect(api.discoveries).toBe(0);
    expect(api.proposals.map((request) => request.sessionRef)).toEqual(['session-older']);
    expect(api.proposals.map((request) => request.source)).toEqual(['claude-code']);
  });

  it('still enumerates when only --session is given, because the harness is unknown', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    await commandFor(api).run({
      args: [],
      flags: { session: 'session-older' },
      json: false,
      io: sink.io,
    });

    expect(api.discoveries).toBe(1);
  });

  it('rejects a --source that names no harness Mneia can read', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    const sink = capture();

    await expect(
      commandFor(api).run({
        args: [],
        flags: { session: 'session-older', source: 'vscode' },
        json: false,
        io: sink.io,
      }),
    ).rejects.toThrow(/not a harness Mneia can read/);
  });

  it('refuses --source without --session, which would still enumerate', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    const sink = capture();

    await expect(
      commandFor(api).run({
        args: [],
        flags: { source: 'claude-code' },
        json: false,
        io: sink.io,
      }),
    ).rejects.toThrow(/only means something alongside --session/);
  });

  it('lists the discovered refs when --session matches none of them', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    await expect(
      commandFor(api).run({ args: [], flags: { session: 'nope' }, json: false, io: sink.io }),
    ).rejects.toThrow(/matches none of the 2 sessions.*session-newest.*session-older/s);
  });

  it('refuses to guess when --session matches more than one', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    await expect(
      commandFor(api).run({ args: [], flags: { session: 'session-' }, json: false, io: sink.io }),
    ).rejects.toThrow(/matches 2 discovered sessions/);
  });

  it('refuses --session together with --all-sessions', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    const sink = capture();

    await expect(
      commandFor(api).run({
        args: [],
        flags: { session: 'x', 'all-sessions': true },
        json: false,
        io: sink.io,
      }),
    ).rejects.toThrow(/cannot be combined/);
  });

  it('checkpoints every discovered session under --all-sessions', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    const sink = capture();

    const code = await commandFor(api).run({
      args: [],
      flags: { 'all-sessions': true },
      json: false,
      io: sink.io,
    });

    expect(code).toBe(0);
    expect(api.proposals.map((request) => request.sessionRef)).toEqual([
      'session-newest',
      'session-older',
    ]);
    expect(api.commits).toHaveLength(2);
    expect(sink.out.join('')).toContain('2 of 2 sessions recorded a checkpoint');
  });

  it('reports a per-session failure and carries on rather than dying on the first', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    api.failOn = 'session-newest';
    const sink = capture();

    const code = await commandFor(api).run({
      args: [],
      flags: { 'all-sessions': true },
      json: false,
      io: sink.io,
    });

    expect(code).toBe(1);
    expect(api.commits).toHaveLength(1);
    const printed = sink.out.join('');
    expect(printed).toContain('failed: the API could not be reached');
    expect(printed).toContain('1 of 2 sessions recorded a checkpoint');
    expect(printed).toContain('resumes from its own watermark');
  });

  it('reports every session separately under --json', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [NEWEST_SESSION, OLDER_SESSION];
    api.failOn = 'session-older';
    const sink = capture();

    await commandFor(api).run({
      args: [],
      flags: { 'all-sessions': true },
      json: true,
      io: sink.io,
    });

    expect(JSON.parse(sink.out.join(''))).toMatchObject({
      discovered: 2,
      processed: 2,
      sessions: [
        { sessionRef: 'session-newest', checkpointId: CHECKPOINT_ID, error: null },
        { sessionRef: 'session-older', checkpointId: null },
      ],
    });
  });

  it('names the directory when no agent session was found at all', async () => {
    const api = new FakeApi(proposalOf([candidate({ index: 0 })]));
    api.sessions = [];
    const sink = capture();

    await expect(
      commandFor(api).run({ args: [], flags: {}, json: false, io: sink.io }),
    ).rejects.toThrow(/found no agent session for \/repo/);
  });
});
