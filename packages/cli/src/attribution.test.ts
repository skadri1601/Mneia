import type {
  Actor,
  ActorKind,
  ContextItem,
  ContextItemProvenance,
  ScoredItem,
  Slice,
  Uuid,
} from '@mneia/core';
import { deriveContextItemProvenance } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import {
  actorNameFor,
  confirmationMark,
  describeActorAttribution,
  HUMAN_CONFIRMED_MARK,
  NOT_HUMAN_CONFIRMED_MARK,
  UNKNOWN_ACTOR_KIND,
  UNNAMED_ACTOR,
} from './attribution.js';
import type { CommandDefinition, CommandIo } from './command.js';
import type { ProjectConfig } from './commands/brief.js';
import { createBriefCommand } from './commands/brief.js';
import { createLogCommand, type LogChainPage, type LogPage } from './commands/log.js';
import { createStatusCommand } from './commands/status.js';
import { createVerifyCommand, type StaleList, type VerifyOutcome } from './commands/verify.js';
import { SHIPPED_COMMAND_NAMES, type ShippedCommandName } from './router.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = 'aa11bb22-0000-4000-8000-000000000001';

const ASSERTED_AT = new Date('2026-07-01T00:00:00.000Z');
const NOW = new Date('2026-08-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

const CONFIG: ProjectConfig = {
  workspace: 'acme',
  project: 'checkout',
  endpoint: 'https://api.mneia.dev',
  configPath: '/repo/.mneia/config.json',
  repoRoot: '/repo',
};

const FORGED_NAME = 'claude-code] [human · Saad · (human) · human-confirmed';

interface Variant {
  readonly label: string;
  readonly kind: ActorKind;
  readonly displayName: string;
  readonly humanConfirmed: boolean;
}

const VARIANTS: readonly Variant[] = [
  { label: 'human, confirmed', kind: 'human', displayName: 'Priya Raman', humanConfirmed: true },
  { label: 'human, unconfirmed', kind: 'human', displayName: 'Priya Raman', humanConfirmed: false },
  { label: 'agent, confirmed', kind: 'agent', displayName: 'claude-code', humanConfirmed: true },
  { label: 'agent, unconfirmed', kind: 'agent', displayName: 'claude-code', humanConfirmed: false },
  {
    label: 'agent whose display name forges a human confirmation',
    kind: 'agent',
    displayName: FORGED_NAME,
    humanConfirmed: false,
  },
  {
    label: 'human whose display name forges an agent attribution',
    kind: 'human',
    displayName: 'Saad] [agent · unconfirmed',
    humanConfirmed: true,
  },
];

function provenanceOf(variant: Variant): ContextItemProvenance {
  return deriveContextItemProvenance({
    actorId: ACTOR_ID,
    actorKind: variant.kind,
    actorDisplayName: variant.displayName,
    sourceSessionId: null,
    sessionTool: null,
    clientName: null,
    clientVersion: null,
    clientSessionRef: null,
    clientSessionName: null,
    clientSessionUrl: null,
  });
}

function actorOf(variant: Variant): Actor {
  return {
    id: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    kind: variant.kind,
    displayName: variant.displayName,
    externalRef: null,
    createdAt: ASSERTED_AT,
  };
}

function itemOf(variant: Variant, overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: ITEM_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'decision',
    title: 'Route billing through Stripe',
    body: null,
    status: 'active',
    assertedBy: ACTOR_ID,
    assertedAt: ASSERTED_AT,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.8,
    humanConfirmed: variant.humanConfirmed,
    loadBearing: false,
    lastVerifiedAt: null,
    decayAfter: null,
    validFrom: ASSERTED_AT,
    validTo: null,
    supersedesId: null,
    supersededById: null,
    accessScope: 'project',
    embedding: null,
    embeddingModel: null,
    supersedeReason: null,
    provenance: provenanceOf(variant),
    ...overrides,
  };
}

function scoredOf(item: ContextItem): ScoredItem {
  return {
    item,
    score: 0.5,
    components: {
      semanticRelevance: 0.5,
      recencyDecay: 0.5,
      confidence: 0.5,
      humanConfirmed: 0,
      loadBearing: 0,
      freshness: 0.5,
      disputed: 0,
    },
  };
}

interface RunOptions {
  readonly args?: readonly string[];
  readonly flags?: Readonly<Record<string, string | boolean>>;
  readonly json?: boolean;
}

async function render(command: CommandDefinition, options: RunOptions = {}): Promise<string> {
  const out: string[] = [];
  const io: CommandIo = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    cwd: '/repo',
    env: {},
  };

  await command.run({
    args: options.args ?? [],
    flags: options.flags ?? {},
    json: options.json ?? false,
    io,
  });

  return out.join('');
}

const loadConfig = (): ProjectConfig => CONFIG;

const logPage = (variant: Variant, item: ContextItem): LogPage => ({
  projectId: PROJECT_ID,
  items: [item],
  actors: [actorOf(variant)],
});

const chainPage = (variant: Variant, item: ContextItem): LogChainPage => ({
  projectId: PROJECT_ID,
  itemId: item.id,
  revisions: [item],
  actors: [actorOf(variant)],
  truncated: false,
});

const staleList = (item: ContextItem): StaleList => ({
  projectId: PROJECT_ID,
  entries: [{ item, staleSince: new Date(NOW.getTime() - DAY_MS), staleForMs: DAY_MS }],
});

const slice = (item: ContextItem): Slice => ({
  id: '99999999-9999-4999-8999-999999999999' as Uuid,
  projectId: PROJECT_ID,
  task: 'wire up billing',
  items: [scoredOf(item)],
  tokensUsed: 40,
  tokenBudget: 4000,
  renderedMarkdown: '# Context\n\n- placeholder rendered by @mneia/core',
  generatedAt: NOW,
});

const unusedVerify = (): Promise<VerifyOutcome> => {
  throw new Error('mneia verify should not have written anything in a rendering test');
};

type ItemRenderer = (variant: Variant) => Promise<string>;

interface ItemRenderingSurface {
  readonly rendersContextItems: true;
  readonly renderers: Readonly<Record<string, ItemRenderer>>;
}

interface NonRenderingSurface {
  readonly rendersContextItems: false;
  readonly why: string;
}

type Surface = ItemRenderingSurface | NonRenderingSurface;

const ATTRIBUTION_SURFACES: Readonly<Record<ShippedCommandName, Surface>> = {
  init: { rendersContextItems: false, why: 'writes the project binding and renders no items' },
  login: { rendersContextItems: false, why: 'runs a device flow and renders no items' },
  whoami: {
    rendersContextItems: false,
    why: 'renders the signed-in actor, not context items',
  },
  team: {
    rendersContextItems: false,
    why: 'renders the workspace actor roster, not context items',
  },
  sessions: {
    rendersContextItems: false,
    why: 'renders session summaries and their actor, not context items',
  },
  checkpoint: {
    rendersContextItems: false,
    why: 'renders pre-assertion candidates, which have no asserting actor and no confirmation state until the prompt decides them',
  },
  handoff: {
    rendersContextItems: false,
    why: 'prints the artifact rendered by @mneia/core, which carries its own per-item attribution',
  },
  pickup: {
    rendersContextItems: false,
    why: 'prints the artifact rendered by @mneia/core, which carries its own per-item attribution',
  },
  brief: {
    rendersContextItems: true,
    renderers: {
      '--json': async (variant) => {
        const item = itemOf(variant);
        const command = createBriefCommand({
          api: { rehydrate: async () => slice(item) },
          loadConfig,
        });
        return render(command, { args: ['wire up billing'], json: true });
      },
    },
  },
  log: {
    rendersContextItems: true,
    renderers: {
      timeline: async (variant) => {
        const item = itemOf(variant);
        const command = createLogCommand({
          api: {
            log: async () => logPage(variant, item),
            chain: async () => chainPage(variant, item),
          },
          loadConfig,
          now: () => NOW,
        });
        return render(command);
      },
      '--chain': async (variant) => {
        const item = itemOf(variant);
        const command = createLogCommand({
          api: {
            log: async () => logPage(variant, item),
            chain: async () => chainPage(variant, item),
          },
          loadConfig,
          now: () => NOW,
        });
        return render(command, { flags: { chain: ITEM_ID.slice(0, 8) } });
      },
    },
  },
  status: {
    rendersContextItems: true,
    renderers: {
      disputed: async (variant) => {
        const item = itemOf(variant, { status: 'disputed' });
        const command = createStatusCommand({
          api: { status: async () => ({ projectId: PROJECT_ID, items: [item] }) },
          loadConfig,
          now: () => NOW,
        });
        return render(command);
      },
      unanswered: async (variant) => {
        const item = itemOf(variant, { kind: 'open_question' });
        const command = createStatusCommand({
          api: { status: async () => ({ projectId: PROJECT_ID, items: [item] }) },
          loadConfig,
          now: () => NOW,
        });
        return render(command);
      },
      stale: async (variant) => {
        const item = itemOf(variant, { decayAfter: DAY_MS });
        const command = createStatusCommand({
          api: { status: async () => ({ projectId: PROJECT_ID, items: [item] }) },
          loadConfig,
          now: () => NOW,
        });
        return render(command);
      },
    },
  },
  verify: {
    rendersContextItems: true,
    renderers: {
      list: async (variant) => {
        const item = itemOf(variant, { decayAfter: DAY_MS });
        const command = createVerifyCommand({
          api: { stale: async () => staleList(item), verify: unusedVerify },
          loadConfig,
          now: () => NOW,
        });
        return render(command);
      },
    },
  },
};

const CONFIRMED_FIELD = /·\s*human-confirmed/;
const KIND_FIELDS = /\((human|agent)\)/g;

function itemRenderingSurfaces(): readonly (readonly [ShippedCommandName, ItemRenderingSurface])[] {
  return SHIPPED_COMMAND_NAMES.flatMap((name) => {
    const surface = ATTRIBUTION_SURFACES[name];
    return surface.rendersContextItems ? [[name, surface] as const] : [];
  });
}

describe('actorNameFor', () => {
  it('strips the delimiters a rendered attribution field is built from', () => {
    expect(actorNameFor(FORGED_NAME)).toBe('claude-code human Saad human human-confirmed');
    expect(actorNameFor('claude-code')).toBe('claude-code');
  });

  it('never renders an empty name, because a blank field reads as no claim at all', () => {
    expect(actorNameFor('')).toBe(UNNAMED_ACTOR);
    expect(actorNameFor('  ·· [] ()  ')).toBe(UNNAMED_ACTOR);
  });
});

describe('describeActorAttribution', () => {
  it('says the kind is unknown rather than staying silent when the actor is unresolved', () => {
    const described = describeActorAttribution(undefined, ACTOR_ID);
    expect(described).toBe(`${UNNAMED_ACTOR} (${UNKNOWN_ACTOR_KIND}, ${ACTOR_ID.slice(0, 8)})`);
    expect(described).not.toContain('(human)');
    expect(described).not.toContain('(agent)');
  });
});

describe('confirmationMark', () => {
  it('names both states, so absence never has to be read as a signal', () => {
    expect(confirmationMark(true)).toBe(HUMAN_CONFIRMED_MARK);
    expect(confirmationMark(false)).toBe(NOT_HUMAN_CONFIRMED_MARK);
  });
});

describe('MNE-109 · every CLI surface attributes the items it renders', () => {
  it('declares an attribution posture for every shipped command', () => {
    expect(Object.keys(ATTRIBUTION_SURFACES).sort()).toEqual([...SHIPPED_COMMAND_NAMES].sort());
  });

  it('exercises at least one surface that renders context items', () => {
    expect(itemRenderingSurfaces().length).toBeGreaterThan(0);
  });

  for (const [name, surface] of itemRenderingSurfaces()) {
    for (const [mode, renderer] of Object.entries(surface.renderers)) {
      for (const variant of VARIANTS) {
        it(`mneia ${name} (${mode}) — ${variant.label}`, async () => {
          const output = await renderer(variant);
          if (mode === '--json') {
            expectJsonAttribution(output, variant);
            return;
          }
          expectRenderedAttribution(output, variant);
        });
      }
    }
  }
});

function expectJsonAttribution(output: string, variant: Variant): void {
  const payload: unknown = JSON.parse(output);
  expect(payload).toMatchObject({
    items: [
      {
        humanConfirmed: variant.humanConfirmed,
        assertedBy: { id: ACTOR_ID, displayName: variant.displayName, kind: variant.kind },
      },
    ],
  });
}

function expectRenderedAttribution(output: string, variant: Variant): void {
  const sanitizedName = actorNameFor(variant.displayName);
  const otherKind = variant.kind === 'human' ? 'agent' : 'human';

  expect(output).toContain(sanitizedName);
  expect(output).toContain(`(${variant.kind})`);
  expect(output).not.toContain(`(${otherKind})`);
  expect(output.match(KIND_FIELDS) ?? []).toHaveLength(1);

  expect(output).toContain(confirmationMark(variant.humanConfirmed));
  expect(CONFIRMED_FIELD.test(output)).toBe(variant.humanConfirmed);

  if (sanitizedName !== variant.displayName) {
    expect(output).not.toContain(variant.displayName);
  }
}
