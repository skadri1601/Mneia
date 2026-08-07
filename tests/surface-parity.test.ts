import { describe, expect, it } from 'vitest';
import type {
  Actor,
  ContextItem,
  Project,
  ScopedStore,
  TelemetryEmitter,
  Uuid,
} from '../packages/core/src/index.js';
import { assembleSlice } from '../packages/core/src/index.js';
import type { ProjectConfig } from '../packages/cli/src/commands/brief.js';
import { createBriefCommand } from '../packages/cli/src/commands/brief.js';
import type { CommandIo } from '../packages/cli/src/command.js';
import { createToolContextFixture } from '../packages/mcp-server/src/tools/context-fixture.js';
import { rehydrateTool } from '../packages/mcp-server/src/tools/rehydrate.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-05T12:00:00.000Z');
const TASK = 'wire the retry path in charges/worker.rb to the new idempotency key';

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

const CORPUS: readonly ContextItem[] = [
  item({ id: 'aaaaaaa1-0000-4000-8000-000000000001', title: 'we retry with an idempotency key' }),
  item({
    id: 'aaaaaaa1-0000-4000-8000-000000000002',
    title: 'never retry a charge without an idempotency key',
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

function unreachable(method: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${method} must not be called by the parity test`));
}

const STORE: ScopedStore = {
  scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
  getActor: unreachable('getActor'),
  getProject: (id: Uuid) => Promise.resolve(id === PROJECT_ID ? PROJECT : null),
  getProjectBySlug: (slug: string) => Promise.resolve(slug === PROJECT.slug ? PROJECT : null),
  createProject: unreachable('createProject'),
  createSession: unreachable('createSession'),
  endSession: unreachable('endSession'),
  getContextItem: unreachable('getContextItem'),
  listContextItems: (filter) =>
    Promise.resolve(
      CORPUS.filter(
        (entry) =>
          (filter.kinds === undefined || filter.kinds.includes(entry.kind)) &&
          (filter.statuses === undefined || filter.statuses.includes(entry.status)) &&
          (filter.loadBearing === undefined || entry.loadBearing === filter.loadBearing),
      ),
    ),
  searchContextItems: () => Promise.resolve(CORPUS),
  insertContextItem: unreachable('insertContextItem'),
  supersedeContextItem: unreachable('supersedeContextItem'),
  confirmContextItem: unreachable('confirmContextItem'),
  writeCheckpoint: unreachable('writeCheckpoint'),
  getCheckpoint: unreachable('getCheckpoint'),
  listCheckpoints: unreachable('listCheckpoints'),
  createHandoff: unreachable('createHandoff'),
  receiveHandoff: unreachable('receiveHandoff'),
  getHandoff: unreachable('getHandoff'),
  recordConflict: unreachable('recordConflict'),
  listOpenConflicts: unreachable('listOpenConflicts'),
  resolveConflict: unreachable('resolveConflict'),
};

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

async function coreRender(): Promise<string> {
  const { slice } = await assembleSlice({
    store: STORE,
    project: PROJECT,
    task: TASK,
    tokenBudget: 4000,
    now: NOW,
  });
  return slice.renderedMarkdown;
}

async function mcpRender(): Promise<string> {
  const context = createToolContextFixture(STORE, SILENT_TELEMETRY, { now: NOW });
  const result = await rehydrateTool.run(
    rehydrateTool.parse({ task: TASK, project: PROJECT.slug, tokenBudget: 4000 }),
    context,
  );
  const [block] = result.content;
  if (block === undefined) {
    throw new Error('mneia_rehydrate returned no content block');
  }
  return block.text;
}

async function cliRender(): Promise<string> {
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
      rehydrate: async (request) => {
        const { slice } = await assembleSlice({
          store: STORE,
          project: PROJECT,
          task: request.task,
          tokenBudget: request.tokenBudget,
          now: NOW,
        });
        return slice;
      },
    },
    loadConfig: () => CONFIG,
  });

  await command.run({ args: [TASK], flags: {}, json: false, io });
  return out.join('');
}

describe('GUARD (MNE-71, MNE-104) the CLI and the MCP server render one slice, not two', () => {
  it('renders the same markdown body through both surfaces', async () => {
    const [core, mcp, cli] = await Promise.all([coreRender(), mcpRender(), cliRender()]);

    expect(mcp).toBe(core);
    expect(cli).toContain(core.trim());
  });

  it('carries the item ids into both, so item_referenced is measurable from either', async () => {
    const [mcp, cli] = await Promise.all([mcpRender(), cliRender()]);

    for (const entry of CORPUS) {
      const short = entry.id.replaceAll('-', '').slice(0, 8);
      expect(mcp).toContain(short);
      expect(cli).toContain(short);
    }
  });

  it('keeps the load-bearing constraint in both, which is standing rule 2', async () => {
    const [mcp, cli] = await Promise.all([mcpRender(), cliRender()]);
    const constraint = 'never retry a charge without an idempotency key';

    expect(mcp).toContain(constraint);
    expect(cli).toContain(constraint);
  });
});
