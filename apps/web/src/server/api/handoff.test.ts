import type {
  Actor,
  ContextItem,
  Handoff,
  Project,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
} from '@mneia/core';
import { StoreError } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { handleCreateHandoff, handleGetHandoff, handleListHandoffItems, handleReceiveHandoff } =
  await import('./handoff.js');

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SENDER = '44444444-4444-4444-8444-444444444444';
const RECIPIENT = '55555555-5555-4555-8555-555555555555';
const HANDOFF_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-08-08T12:00:00.000Z');

const PROJECT: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'payments-migration',
  repoUrl: null,
  createdAt: NOW,
};

const SENDER_ACTOR: Actor = {
  id: SENDER,
  workspaceId: WORKSPACE,
  kind: 'human',
  displayName: 'Saad',
  externalRef: null,
  createdAt: NOW,
};

const RECIPIENT_ACTOR: Actor = { ...SENDER_ACTOR, id: RECIPIENT, displayName: 'Alex' };

const ITEM: ContextItem = {
  id: '77777777-7777-4777-8777-777777777777',
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  kind: 'constraint',
  title: 'No downtime window',
  body: null,
  status: 'active',
  assertedBy: SENDER,
  assertedAt: NOW,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.9,
  humanConfirmed: true,
  loadBearing: true,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: NOW,
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'project',
  embedding: null,
  embeddingModel: null,
  supersedeReason: null,
};

const NEXT_ACTION = 'Wire the retry path to the new idempotency key.';

const handoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  id: HANDOFF_ID,
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  fromActor: SENDER,
  toActor: null,
  createdAt: NOW,
  receivedAt: null,
  nextAction: NEXT_ACTION,
  rendered: '# Handoff: payments-migration',
  ...overrides,
});

const harness = (overrides: Partial<ScopedStore> = {}) => {
  const events: TelemetryEvent[] = [];
  const actors = new Map<string, Actor>([
    [SENDER, SENDER_ACTOR],
    [RECIPIENT, RECIPIENT_ACTOR],
  ]);

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: SENDER },
    getProjectBySlug: vi.fn(async () => PROJECT),
    getProject: vi.fn(async () => PROJECT),
    getActor: vi.fn(async (id: string) => actors.get(id) ?? null),
    listContextItems: vi.fn(async () => [ITEM]),
    createHandoff: vi.fn(async (input: { toActor?: string | null; rendered: string }) =>
      handoff({ toActor: input.toActor ?? null, rendered: input.rendered }),
    ),
    receiveHandoff: vi.fn(async () => handoff({ receivedAt: NOW, toActor: SENDER })),
    getHandoff: vi.fn(async () => handoff()),
    listHandoffItems: vi.fn(async () => [{ section: 'Constraints (do not violate)', item: ITEM }]),
    ...overrides,
  } as unknown as ScopedStore;

  const telemetry = {
    emit: async (event: TelemetryEvent) => {
      events.push(event);
    },
  } as unknown as TelemetryEmitter;

  return { store, events, deps: { telemetry, now: () => NOW } };
};

describe('handleCreateHandoff', () => {
  it('returns a rendered artifact built from project state', async () => {
    const { store, deps } = harness();

    const { handoff: created } = await handleCreateHandoff(
      store,
      { project: 'payments-migration', nextAction: NEXT_ACTION },
      deps,
    );

    expect(created.rendered).toContain('# Handoff: payments-migration');
    expect(created.rendered).toContain('No downtime window');
    expect(created.receivedAt).toBeNull();
  });

  it('emits handoff.created carrying the items the artifact was built from', async () => {
    const { store, events, deps } = harness();

    await handleCreateHandoff(
      store,
      { project: 'payments-migration', nextAction: NEXT_ACTION },
      deps,
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'handoff.created',
      workspaceId: WORKSPACE,
      projectId: PROJECT_ID,
      actorId: SENDER,
      handoffId: HANDOFF_ID,
      itemIds: [ITEM.id],
      toActor: null,
    });
  });

  it('reports an unknown project with a message naming the fix', async () => {
    const { store, deps } = harness({
      getProjectBySlug: vi.fn(async () => null),
      getProject: vi.fn(async () => null),
    });

    await expect(
      handleCreateHandoff(store, { project: 'nope', nextAction: NEXT_ACTION }, deps),
    ).rejects.toThrow(/mneia status/);
  });
});

describe('handleReceiveHandoff', () => {
  it('marks the handoff received and emits handoff.received', async () => {
    const { store, events, deps } = harness();

    const { handoff: received } = await handleReceiveHandoff(store, { id: HANDOFF_ID }, deps);

    expect(received.receivedAt).toBe(NOW.toISOString());
    expect(events[0]).toMatchObject({
      name: 'handoff.received',
      handoffId: HANDOFF_ID,
      receivedBy: SENDER,
    });
  });

  it('reports a second pickup as a bad request rather than a 500', async () => {
    const { store, deps } = harness({
      receiveHandoff: vi.fn(async () => {
        throw new StoreError('already_received', 'expected handoff to be unreceived');
      }),
    });

    await expect(handleReceiveHandoff(store, { id: HANDOFF_ID }, deps)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('reports picking up someone else’s addressed handoff as forbidden', async () => {
    const { store, deps } = harness({
      receiveHandoff: vi.fn(async () => {
        throw new StoreError('wrong_receiver', 'expected handoff to be received by another actor');
      }),
    });

    await expect(handleReceiveHandoff(store, { id: HANDOFF_ID }, deps)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('emits nothing when the pickup was refused', async () => {
    const { store, events, deps } = harness({
      receiveHandoff: vi.fn(async () => {
        throw new StoreError('already_received', 'expected handoff to be unreceived');
      }),
    });

    await expect(handleReceiveHandoff(store, { id: HANDOFF_ID }, deps)).rejects.toBeDefined();
    expect(events).toEqual([]);
  });
});

describe('handleGetHandoff', () => {
  it('returns the frozen artifact, not a re-render', async () => {
    const { store } = harness();

    const { handoff: found } = await handleGetHandoff(store, HANDOFF_ID);

    expect(found?.rendered).toBe('# Handoff: payments-migration');
  });

  it('returns null for a handoff this workspace cannot see', async () => {
    const { store } = harness({ getHandoff: vi.fn(async () => null) });

    const { handoff: found } = await handleGetHandoff(store, HANDOFF_ID);

    expect(found).toBeNull();
  });
});

describe('handleListHandoffItems', () => {
  it('returns the items the artifact was built from, with the section each landed in', async () => {
    const { store } = harness();

    const { items } = await handleListHandoffItems(store, HANDOFF_ID);

    expect(items).toHaveLength(1);
    expect(items[0]?.section).toBe('Constraints (do not violate)');
    expect(items[0]?.item.id).toBe(ITEM.id);
  });

  it('refuses a handoff this workspace cannot see, rather than returning an empty set', async () => {
    const { store } = harness({ getHandoff: vi.fn(async () => null) });

    await expect(handleListHandoffItems(store, HANDOFF_ID)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
