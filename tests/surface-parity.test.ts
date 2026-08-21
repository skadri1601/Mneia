import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CommandIo } from '../packages/cli/src/command.js';
import type { ProjectConfig } from '../packages/cli/src/commands/brief.js';
import { createBriefCommand } from '../packages/cli/src/commands/brief.js';
import { SHIPPED_COMMAND_NAMES, type ShippedCommandName } from '../packages/cli/src/router.js';
import type {
  Actor,
  Checkpoint,
  Conflict,
  ContextItem,
  Handoff,
  HandoffItem,
  HttpTransport,
  Project,
  ProjectSessionSummary,
  ScopedStore,
  Session,
  Slice,
  StaleContextItem,
  TelemetryEmitter,
  Uuid,
} from '../packages/core/src/index.js';
import * as core from '../packages/core/src/index.js';
import { SHIPPED_TOOL_NAMES, type ShippedToolName } from '../packages/mcp-server/src/registry.js';
import { createToolContextFixture } from '../packages/mcp-server/src/tools/context-fixture.js';
import * as surfaceRehydrate from '../packages/mcp-server/src/tools/rehydrate.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-05T12:00:00.000Z');
const TASK = 'wire the retry path in charges/worker.rb to the new idempotency key';
const TOKEN_BUDGET = 4000;
const REHYDRATE_PATH = '/api/v1/rehydrate';

const PROJECT: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  teamId: null,
  slug: 'payments',
  repoUrl: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

function item(overrides: Partial<ContextItem> & { id: Uuid; title: string }): ContextItem {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'decision',
    body: null,
    status: 'active',
    assertedBy: ACTOR_ID,
    assertedAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.9,
    humanConfirmed: true,
    loadBearing: false,
    lastVerifiedAt: null,
    decayAfter: null,
    accessScope: 'project',
    embedding: null,
    embeddingModel: null,
    supersedesId: null,
    supersededById: null,
    validFrom: new Date('2026-08-01T00:00:00.000Z'),
    validTo: null,
    ...overrides,
  } as ContextItem;
}

const LOAD_BEARING_CONSTRAINT = 'never retry a charge without an idempotency key';

const CORPUS: readonly ContextItem[] = [
  item({ id: 'aaaaaaa1-0000-4000-8000-000000000001', title: 'we retry with an idempotency key' }),
  item({
    id: 'aaaaaaa1-0000-4000-8000-000000000002',
    title: LOAD_BEARING_CONSTRAINT,
    kind: 'constraint',
    loadBearing: true,
  }),
  item({
    id: 'aaaaaaa1-0000-4000-8000-000000000003',
    title: 'the worker runs on the payments queue',
    kind: 'fact',
    humanConfirmed: false,
  }),
];

const SILENT_TELEMETRY: TelemetryEmitter = {
  emit: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

const CONFIG: ProjectConfig = {
  workspace: WORKSPACE_ID,
  project: PROJECT.slug,
  endpoint: 'https://api.mneia.dev',
  configPath: '/home/founder/.mneia/local.json',
  repoRoot: '/repo',
};

interface StoreCall {
  readonly method: string;
  readonly argument: string;
}

interface RecordingStore {
  readonly store: ScopedStore;
  readonly calls: readonly StoreCall[];
}

function unreachable(method: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new Error(
        `${method} must not be called while rehydrating; a surface reaching for it is the divergence MNE-104 exists to catch`,
      ),
    );
}

function createRecordingStore(): RecordingStore {
  const calls: StoreCall[] = [];
  const record = (method: string, argument: unknown): void => {
    calls.push({ method, argument: JSON.stringify(argument ?? null) });
  };

  const store: ScopedStore = {
    scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },

    getActor: unreachable('getActor'),
    getProject: (id: Uuid) => {
      record('getProject', id);
      return Promise.resolve(id === PROJECT_ID ? PROJECT : null);
    },
    getProjectBySlug: (slug: string) => {
      record('getProjectBySlug', slug);
      return Promise.resolve(slug === PROJECT.slug ? PROJECT : null);
    },
    createProject: unreachable('createProject'),
    createSession: unreachable('createSession'),
    endSession: unreachable('endSession'),

    getContextItem: unreachable('getContextItem'),
    listContextItems: (filter) => {
      record('listContextItems', filter);
      return Promise.resolve(
        CORPUS.filter(
          (entry) =>
            (filter.kinds === undefined || filter.kinds.includes(entry.kind)) &&
            (filter.statuses === undefined || filter.statuses.includes(entry.status)) &&
            (filter.loadBearing === undefined || entry.loadBearing === filter.loadBearing),
        ),
      );
    },
    searchContextItems: (search) => {
      record('searchContextItems', search);
      return Promise.resolve(CORPUS);
    },
    listStaleContextItems: unreachable('listStaleContextItems') as () => Promise<
      readonly StaleContextItem[]
    >,
    insertContextItem: unreachable('insertContextItem'),
    supersedeContextItem: unreachable('supersedeContextItem'),
    confirmContextItem: unreachable('confirmContextItem'),
    verifyContextItem: unreachable('verifyContextItem'),
    retireContextItem: unreachable('retireContextItem'),

    writeCheckpoint: unreachable('writeCheckpoint'),
    getCheckpoint: unreachable('getCheckpoint'),
    listCheckpoints: unreachable('listCheckpoints') as () => Promise<readonly Checkpoint[]>,

    createHandoff: unreachable('createHandoff'),
    receiveHandoff: unreachable('receiveHandoff'),
    getHandoff: unreachable('getHandoff'),
    listOpenHandoffs: unreachable('listOpenHandoffs') as () => Promise<readonly Handoff[]>,
    listInboxHandoffs: unreachable('listInboxHandoffs') as () => Promise<readonly Handoff[]>,
    listHandoffItems: unreachable('listHandoffItems') as () => Promise<readonly HandoffItem[]>,

    listWorkspaceActors: unreachable('listWorkspaceActors') as () => Promise<readonly Actor[]>,
    listProjectSessions: unreachable('listProjectSessions') as () => Promise<
      readonly ProjectSessionSummary[]
    >,

    recordConflict: unreachable('recordConflict'),
    listOpenConflicts: unreachable('listOpenConflicts') as () => Promise<readonly Conflict[]>,
    resolveConflict: unreachable('resolveConflict'),
  };

  return { store, calls };
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`expected ${key} to be a string; received ${typeof value}`);
  }
  return value;
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number') {
    throw new Error(`expected ${key} to be a number; received ${typeof value}`);
  }
  return value;
}

function readRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`expected ${what} to be an object; received ${JSON.stringify(value)}`);
  }
  return { ...value } as Record<string, unknown>;
}

function readIdList(source: Record<string, unknown>, key: string): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`expected ${key} to be an array; received ${typeof value}`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`expected ${key}[${index}] to be a string; received ${typeof entry}`);
    }
    return entry;
  });
}

interface SurfaceResult {
  readonly renderedMarkdown: string;
  readonly itemIds: readonly string[];
  readonly tokenBudget: number;
  readonly tokensUsed: number;
  readonly calls: readonly StoreCall[];
}

async function coreLeg(): Promise<{ slice: Slice; calls: readonly StoreCall[] }> {
  const { store, calls } = createRecordingStore();
  const project = await core.resolveProject(store, PROJECT.slug);
  if (project === null) {
    throw new Error(`the fixture store did not resolve project ${PROJECT.slug}`);
  }
  const { slice } = await core.assembleSlice({
    store,
    project,
    task: TASK,
    tokenBudget: TOKEN_BUDGET,
    now: NOW,
  });
  return { slice, calls };
}

async function mcpLeg(): Promise<SurfaceResult> {
  const { store, calls } = createRecordingStore();
  const context = createToolContextFixture(store, SILENT_TELEMETRY, { now: NOW });
  const result = await surfaceRehydrate.rehydrateTool.run(
    surfaceRehydrate.rehydrateTool.parse({
      task: TASK,
      project: PROJECT.slug,
      tokenBudget: TOKEN_BUDGET,
    }),
    context,
  );

  if (result.isError === true) {
    throw new Error(`mneia_rehydrate failed: ${JSON.stringify(result.structuredContent)}`);
  }

  const [block] = result.content;
  if (block === undefined) {
    throw new Error('mneia_rehydrate returned no content block');
  }

  const structured = readRecord(result.structuredContent, 'mneia_rehydrate structuredContent');

  return {
    renderedMarkdown: block.text,
    itemIds: readIdList(structured, 'itemIds'),
    tokenBudget: readNumber(structured, 'tokenBudget'),
    tokensUsed: readNumber(structured, 'tokensUsed'),
    calls,
  };
}

function hostedRehydrateTransport(store: ScopedStore): HttpTransport {
  return {
    request: async (path, schema, body) => {
      if (path !== REHYDRATE_PATH) {
        throw new Error(
          `mneia brief reached ${path}; the parity fixture only serves ${REHYDRATE_PATH}`,
        );
      }
      const request = readRecord(body, 'the rehydrate request body');
      const project = await core.resolveProject(store, readString(request, 'project'));
      if (project === null) {
        throw new Error(`the fixture store did not resolve project ${readString(request, 'project')}`);
      }
      const { slice } = await core.assembleSlice({
        store,
        project,
        task: readString(request, 'task'),
        tokenBudget: readNumber(request, 'tokenBudget'),
        now: NOW,
      });
      return schema.parse({ slice: core.encodeSlice(slice) });
    },
  };
}

async function cliLeg(json: boolean): Promise<{ output: string; calls: readonly StoreCall[] }> {
  const { store, calls } = createRecordingStore();
  const remote = core.createRemoteStore({
    transport: hostedRehydrateTransport(store),
    scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
  });

  const out: string[] = [];
  const io: CommandIo = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    cwd: '/repo',
    env: {},
  };

  const command = createBriefCommand({
    api: {
      rehydrate: (request) =>
        remote.rehydrate({
          project: request.config.project,
          task: request.task,
          tokenBudget: request.tokenBudget,
        }),
    },
    loadConfig: () => CONFIG,
  });

  await command.run({ args: [TASK], flags: {}, json, io });
  return { output: out.join(''), calls };
}

async function cliJsonLeg(): Promise<SurfaceResult> {
  const { output, calls } = await cliLeg(true);
  const payload = readRecord(JSON.parse(output), 'the mneia brief --json payload');
  const items = payload.items;
  if (!Array.isArray(items)) {
    throw new Error('expected mneia brief --json to carry an items array');
  }
  return {
    renderedMarkdown: readString(payload, 'renderedMarkdown'),
    itemIds: items.map((entry, index) =>
      readString(readRecord(entry, `items[${index}]`), 'id'),
    ),
    tokenBudget: readNumber(payload, 'tokenBudget'),
    tokensUsed: readNumber(payload, 'tokensUsed'),
    calls,
  };
}

type CommandParity =
  | {
      readonly kind: 'paired';
      readonly tools: readonly ShippedToolName[];
      readonly sharedCore: readonly string[];
    }
  | { readonly kind: 'command-only'; readonly why: string };

type ToolParity =
  | {
      readonly kind: 'paired';
      readonly commands: readonly ShippedCommandName[];
      readonly sharedCore: readonly string[];
    }
  | { readonly kind: 'tool-only'; readonly why: string };

const COMMAND_PARITY: Readonly<Record<ShippedCommandName, CommandParity>> = {
  brief: {
    kind: 'paired',
    tools: ['mneia_rehydrate'],
    sharedCore: ['assembleSlice'],
  },
  checkpoint: {
    kind: 'paired',
    tools: ['mneia_checkpoint'],
    sharedCore: ['writeCheckpoint'],
  },
  handoff: {
    kind: 'paired',
    tools: ['mneia_handoff_create'],
    sharedCore: ['assembleHandoff'],
  },
  pickup: {
    kind: 'paired',
    tools: ['mneia_handoff_receive', 'mneia_handoff_inbox'],
    sharedCore: ['receiveHandoff', 'listInboxHandoffs'],
  },
  team: {
    kind: 'paired',
    tools: ['mneia_team'],
    sharedCore: ['listWorkspaceActors'],
  },
  sessions: {
    kind: 'paired',
    tools: ['mneia_sessions'],
    sharedCore: ['listProjectSessions'],
  },
  init: {
    kind: 'command-only',
    why: 'binds a working directory to a project and imports the constraints it already documents; an MCP client has no working directory to bind, so the tool surface takes the project from its own configuration instead',
  },
  login: {
    kind: 'command-only',
    why: 'runs the device authorisation flow that puts a token on this machine; an MCP server is handed its token by the host that launches it, so there is nothing for a tool to do',
  },
  whoami: {
    kind: 'command-only',
    why: 'prints which actor, workspace, and team this machine is signed in as; the MCP host already knows the identity it configured, so no tool reports it back',
  },
  log: {
    kind: 'command-only',
    why: 'browses the decision history newest-first for a human reading a terminal; an agent reaches the same history through the rehydration slice and mneia_search rather than through a paginated listing',
  },
  status: {
    kind: 'command-only',
    why: 'reports what is stale, disputed, or unanswered so a human can act on it; no tool exposes project health, which means an agent cannot see a disputed item until it appears in a slice',
  },
  verify: {
    kind: 'command-only',
    why: 'runs the human re-verification prompt through verifyContextItem. mneia_retire is not its counterpart: it retires through retireContextItem, a different store method with different preconditions, so the two surfaces do not share this path',
  },
};

const TOOL_PARITY: Readonly<Record<ShippedToolName, ToolParity>> = {
  mneia_rehydrate: {
    kind: 'paired',
    commands: ['brief'],
    sharedCore: ['assembleSlice'],
  },
  mneia_checkpoint: {
    kind: 'paired',
    commands: ['checkpoint'],
    sharedCore: ['writeCheckpoint'],
  },
  mneia_handoff_create: {
    kind: 'paired',
    commands: ['handoff'],
    sharedCore: ['assembleHandoff'],
  },
  mneia_handoff_receive: {
    kind: 'paired',
    commands: ['pickup'],
    sharedCore: ['receiveHandoff'],
  },
  mneia_handoff_inbox: {
    kind: 'paired',
    commands: ['pickup'],
    sharedCore: ['listInboxHandoffs'],
  },
  mneia_team: {
    kind: 'paired',
    commands: ['team'],
    sharedCore: ['listWorkspaceActors'],
  },
  mneia_sessions: {
    kind: 'paired',
    commands: ['sessions'],
    sharedCore: ['listProjectSessions'],
  },
  mneia_assert: {
    kind: 'tool-only',
    why: 'writes one item at the moment a decision lands, which is how an agent works; the CLI writes through checkpoint, a human review flow, and standing rule 1 is the reason there is deliberately no mneia assert command',
  },
  mneia_retire: {
    kind: 'tool-only',
    why: 'retires any active or disputed item through retireContextItem. The CLI can only retire what the stale list already offered, and does it through verifyContextItem, so a disputed item is retirable from an agent and not from a terminal',
  },
  mneia_search: {
    kind: 'tool-only',
    why: 'looks up a specific remembered thing by query when the agent already knows what it wants; the CLI has no search command, and a human reaches the same rows through log and status',
  },
};

const MIN_ONE_SIDED_REASON_LENGTH = 40;

const scopedStoreMethodNames = (): readonly string[] => {
  const source = readFileSync(
    new URL('../packages/core/src/store/adapter/types.ts', import.meta.url),
    'utf8',
  );
  const block = /export interface ScopedStore\s*\{([\s\S]*?)\n\}/.exec(source);
  if (block === null) {
    throw new Error('expected ScopedStore to be declared in packages/core/src/store/adapter/types.ts');
  }
  const body = block[1] ?? '';
  return [...body.matchAll(/^\s{2}(\w+)\??\s*[(<]/gm)].map((match) => match[1] ?? '');
};

const STORE_METHODS: ReadonlySet<string> = new Set(scopedStoreMethodNames());
const CORE_EXPORTS: ReadonlySet<string> = new Set(Object.keys(core));

const resolvesInCore = (name: string): boolean =>
  CORE_EXPORTS.has(name) || STORE_METHODS.has(name);

const pairedCommands = (): readonly (readonly [
  ShippedCommandName,
  Extract<CommandParity, { kind: 'paired' }>,
])[] =>
  SHIPPED_COMMAND_NAMES.flatMap((name) => {
    const parity = COMMAND_PARITY[name];
    return parity.kind === 'paired' ? [[name, parity] as const] : [];
  });

const pairedTools = (): readonly (readonly [
  ShippedToolName,
  Extract<ToolParity, { kind: 'paired' }>,
])[] =>
  SHIPPED_TOOL_NAMES.flatMap((name) => {
    const parity = TOOL_PARITY[name];
    return parity.kind === 'paired' ? [[name, parity] as const] : [];
  });

const SURFACE_SOURCE_ROOTS: readonly string[] = [
  '../packages/cli/src',
  '../packages/mcp-server/src',
];

const CORE_ONLY_ALGORITHM: readonly string[] = [
  'assembleSlice',
  'scoreItems',
  'packSlice',
  'renderSlice',
  'assembleHandoff',
  'renderHandoff',
];

function surfaceSourceFiles(): readonly string[] {
  return SURFACE_SOURCE_ROOTS.flatMap((root) => {
    const base = new URL(`${root}/`, import.meta.url);
    return readdirSync(base, { recursive: true, encoding: 'utf8' })
      .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      .map((entry) => `${root}/${entry.split('\\').join('/')}`);
  });
}

function definesLocally(source: string, name: string): boolean {
  const declaration = new RegExp(
    `^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\b|^\\s*(?:export\\s+)?const\\s+${name}\\s*[:=]`,
    'm',
  );
  return declaration.test(source);
}

describe('GUARD (MNE-71, MNE-104) the CLI and the MCP server render one slice, not two', () => {
  it('renders byte-identical markdown through both surfaces', async () => {
    const [{ slice }, mcp, cli] = await Promise.all([coreLeg(), mcpLeg(), cliJsonLeg()]);

    expect(mcp.renderedMarkdown).toBe(slice.renderedMarkdown);
    expect(cli.renderedMarkdown).toBe(slice.renderedMarkdown);
  });

  it('returns the same item set, in the same order, with the same budget accounting', async () => {
    const [{ slice }, mcp, cli] = await Promise.all([coreLeg(), mcpLeg(), cliJsonLeg()]);
    const coreIds = slice.items.map((scored) => scored.item.id);

    expect(mcp.itemIds).toEqual(coreIds);
    expect(cli.itemIds).toEqual(coreIds);
    expect(cli.tokenBudget).toBe(mcp.tokenBudget);
    expect(cli.tokensUsed).toBe(mcp.tokensUsed);
    expect(mcp.tokenBudget).toBe(slice.tokenBudget);
    expect(mcp.tokensUsed).toBe(slice.tokensUsed);
  });

  it('makes the same store calls with the same arguments, so neither surface filters locally', async () => {
    const [coreOnly, mcp, cli] = await Promise.all([coreLeg(), mcpLeg(), cliJsonLeg()]);

    expect(mcp.calls).toEqual(coreOnly.calls);
    expect(cli.calls).toEqual(coreOnly.calls);
    expect(mcp.calls.map((call) => call.method)).toEqual([
      'getProjectBySlug',
      'searchContextItems',
      'listContextItems',
      'listContextItems',
    ]);
  });

  it('carries the item ids into both, so item_referenced is measurable from either', async () => {
    const [mcp, human] = await Promise.all([mcpLeg(), cliLeg(false)]);

    for (const entry of CORPUS) {
      const short = entry.id.replaceAll('-', '').slice(0, 8);
      expect(mcp.renderedMarkdown).toContain(short);
      expect(human.output).toContain(short);
    }
  });

  it('keeps the load-bearing constraint in both, which is standing rule 2', async () => {
    const [mcp, human] = await Promise.all([mcpLeg(), cliLeg(false)]);

    expect(mcp.renderedMarkdown).toContain(LOAD_BEARING_CONSTRAINT);
    expect(human.output).toContain(LOAD_BEARING_CONSTRAINT);
  });

  it('lets the terminal add its own footer without changing the slice it wraps', async () => {
    const [{ slice }, human] = await Promise.all([coreLeg(), cliLeg(false)]);

    expect(human.output).toContain(slice.renderedMarkdown.trim());
    expect(human.output).toContain(`task: ${TASK}`);
  });
});

describe('GUARD (MNE-104) every shipped command and tool declares its counterpart', () => {
  it('declares a parity entry for every shipped command', () => {
    expect(Object.keys(COMMAND_PARITY).sort()).toEqual([...SHIPPED_COMMAND_NAMES].sort());
  });

  it('declares a parity entry for every shipped tool', () => {
    expect(Object.keys(TOOL_PARITY).sort()).toEqual([...SHIPPED_TOOL_NAMES].sort());
  });

  it('names only counterparts that are themselves shipped', () => {
    for (const [name, parity] of pairedCommands()) {
      expect(parity.tools.length, `${name} is paired but names no tool`).toBeGreaterThan(0);
      for (const tool of parity.tools) {
        expect(SHIPPED_TOOL_NAMES, `${name} names ${tool}`).toContain(tool);
      }
    }
    for (const [name, parity] of pairedTools()) {
      expect(parity.commands.length, `${name} is paired but names no command`).toBeGreaterThan(0);
      for (const command of parity.commands) {
        expect(SHIPPED_COMMAND_NAMES, `${name} names ${command}`).toContain(command);
      }
    }
  });

  it('pairs symmetrically, so neither side can claim a counterpart alone', () => {
    for (const [name, parity] of pairedCommands()) {
      for (const tool of parity.tools) {
        const other = TOOL_PARITY[tool];
        expect(other.kind, `${name} pairs with ${tool}, which declares itself tool-only`).toBe(
          'paired',
        );
        if (other.kind === 'paired') {
          expect(other.commands, `${tool} must name ${name} back`).toContain(name);
        }
      }
    }
    for (const [name, parity] of pairedTools()) {
      for (const command of parity.commands) {
        const other = COMMAND_PARITY[command];
        expect(other.kind, `${name} pairs with ${command}, which declares itself command-only`).toBe(
          'paired',
        );
        if (other.kind === 'paired') {
          expect(other.tools, `${command} must name ${name} back`).toContain(name);
        }
      }
    }
  });

  it('names a shared core entry point that actually exists, for every pair', () => {
    for (const [name, parity] of pairedCommands()) {
      for (const entry of parity.sharedCore) {
        expect(resolvesInCore(entry), `${name} names ${entry}, which @mneia/core does not`).toBe(
          true,
        );
      }
      for (const tool of parity.tools) {
        const other = TOOL_PARITY[tool];
        if (other.kind !== 'paired') {
          continue;
        }
        const overlap = other.sharedCore.filter((entry) => parity.sharedCore.includes(entry));
        expect(
          overlap.length,
          `${name} and ${tool} are paired but name no shared entry point; a pair that shares no code in @mneia/core is two implementations`,
        ).toBeGreaterThan(0);
      }
    }
    for (const [name, parity] of pairedTools()) {
      for (const entry of parity.sharedCore) {
        expect(resolvesInCore(entry), `${name} names ${entry}, which @mneia/core does not`).toBe(
          true,
        );
      }
    }
  });

  it('states a reason for every surface that is deliberately one-sided', () => {
    for (const name of SHIPPED_COMMAND_NAMES) {
      const parity = COMMAND_PARITY[name];
      if (parity.kind === 'command-only') {
        expect(
          parity.why.length,
          `${name} is declared command-only without saying why the MCP surface does not carry it`,
        ).toBeGreaterThanOrEqual(MIN_ONE_SIDED_REASON_LENGTH);
      }
    }
    for (const name of SHIPPED_TOOL_NAMES) {
      const parity = TOOL_PARITY[name];
      if (parity.kind === 'tool-only') {
        expect(
          parity.why.length,
          `${name} is declared tool-only without saying why the CLI does not carry it`,
        ).toBeGreaterThanOrEqual(MIN_ONE_SIDED_REASON_LENGTH);
      }
    }
  });
});

describe('GUARD (MNE-104) neither surface reimplements what @mneia/core owns', () => {
  it('defines the rehydration and handoff algorithms in core only', () => {
    for (const file of surfaceSourceFiles()) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      for (const name of CORE_ONLY_ALGORITHM) {
        expect(
          definesLocally(source, name),
          `${file} declares its own ${name}; that algorithm belongs to @mneia/core, and a second copy is how the CLI and the MCP server start answering differently`,
        ).toBe(false);
      }
    }
  });

  it('holds the MCP server copies of the rehydration limits to the values core uses', () => {
    expect(surfaceRehydrate.MANDATORY_ITEM_LIMIT).toBe(core.MANDATORY_ITEM_LIMIT);
    expect(surfaceRehydrate.RECENT_SUPERSEDED_LIMIT).toBe(core.RECENT_SUPERSEDED_LIMIT);
    expect(surfaceRehydrate.MAX_CANDIDATES).toBe(core.MAX_CANDIDATES);
    expect(surfaceRehydrate.DEFAULT_TOKEN_BUDGET).toBe(TOKEN_BUDGET);
  });
});
