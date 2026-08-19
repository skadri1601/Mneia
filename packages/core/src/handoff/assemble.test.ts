import { describe, expect, it, vi } from 'vitest';
import type { Actor, ContextItem, Handoff, Project, Uuid } from '../domain/types.js';
import type { NewHandoff, ScopedStore } from '../store/adapter/types.js';
import { assembleHandoff, DEFAULT_SUPERSEDED_WINDOW_DAYS } from './assemble.js';

const id = (prefix: string): Uuid => `${prefix}-1111-4111-8111-111111111111`;

const WORKSPACE = id('w0rkspac');
const PROJECT_ID = id('pr0ject0');
const HUMAN = id('human000');
const AGENT = id('agent000');
const NOW = new Date('2026-07-26T18:40:07.500Z');

const PROJECT: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'payments-migration',
  repoUrl: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

const actor = (overrides: Partial<Actor>): Actor => ({
  id: HUMAN,
  workspaceId: WORKSPACE,
  kind: 'human',
  displayName: 'Saad',
  externalRef: null,
  createdAt: PROJECT.createdAt,
  ...overrides,
});

const SAAD = actor({});
const CLAUDE = actor({ id: AGENT, kind: 'agent', displayName: 'claude-code' });

const contextItem = (overrides: Partial<ContextItem>): ContextItem => ({
  id: id('item0000'),
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  kind: 'constraint',
  title: 'No downtime window',
  body: null,
  status: 'active',
  assertedBy: HUMAN,
  assertedAt: new Date('2026-07-14T09:30:00.000Z'),
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.9,
  humanConfirmed: true,
  loadBearing: true,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: new Date('2026-07-14T09:30:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'project',
  embedding: null,
  embeddingModel: null,
  supersedeReason: null,
  ...overrides,
});

interface Stub {
  readonly store: ScopedStore;
  readonly created: NewHandoff[];
  readonly filters: unknown[];
}

const storeStub = (overrides: Partial<ScopedStore> = {}, items: readonly ContextItem[] = []) => {
  const created: NewHandoff[] = [];
  const filters: unknown[] = [];
  const actors = new Map<Uuid, Actor>([
    [HUMAN, SAAD],
    [AGENT, CLAUDE],
  ]);

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: HUMAN },
    getProject: vi.fn(async () => PROJECT),
    getActor: vi.fn(async (actorId: Uuid) => actors.get(actorId) ?? null),
    listContextItems: vi.fn(async (filter: unknown) => {
      filters.push(filter);
      return items;
    }),
    createHandoff: vi.fn(async (handoff: NewHandoff): Promise<Handoff> => {
      created.push(handoff);
      return {
        id: id('hand0ff0'),
        workspaceId: WORKSPACE,
        projectId: handoff.projectId,
        fromActor: handoff.fromActor,
        toActor: handoff.toActor ?? null,
        createdAt: NOW,
        receivedAt: null,
        nextAction: handoff.nextAction,
        rendered: handoff.rendered,
      };
    }),
    ...overrides,
  } as unknown as ScopedStore;

  return { store, created, filters } satisfies Stub;
};

const NEXT_ACTION = 'Wire the retry path in `charges/worker.rb` to the new idempotency key.';

describe('assembleHandoff', () => {
  it('renders the artifact and stores it, so handoff.rendered is never empty', async () => {
    const { store, created } = storeStub({}, [contextItem({})]);

    const { handoff } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(created).toHaveLength(1);
    expect(handoff.rendered).toContain('# Handoff: payments-migration');
    expect(handoff.rendered).toContain('No downtime window');
    expect(handoff.nextAction).toBe(NEXT_ACTION);
  });

  it('creates an open handoff when no recipient is named', async () => {
    const { store, created } = storeStub();

    const { handoff } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(created[0]?.toActor).toBeNull();
    expect(handoff.rendered).toContain('To: open');
  });

  it('addresses the handoff when a recipient is named', async () => {
    const { store, created } = storeStub();

    const { handoff } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      toActor: AGENT,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(created[0]?.toActor).toBe(AGENT);
    expect(handoff.rendered).toContain('To: claude-code (agent)');
  });

  it('reads superseded items too, or the block nobody else produces would always be empty', async () => {
    const { store, filters } = storeStub();

    await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(filters[0]).toMatchObject({
      projectId: PROJECT_ID,
      statuses: ['active', 'disputed', 'superseded'],
    });
  });

  it('windows the superseded block on the default when none is given', async () => {
    const stale = new Date(
      NOW.getTime() - (DEFAULT_SUPERSEDED_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const { store } = storeStub({}, [
      contextItem({ status: 'superseded', title: 'Redis-based cutover lock', validTo: stale }),
    ]);

    const { handoff } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(handoff.rendered).not.toContain('Redis-based cutover lock');
  });

  it('honours a wider window when the caller asks for one', async () => {
    const stale = new Date(
      NOW.getTime() - (DEFAULT_SUPERSEDED_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const { store } = storeStub({}, [
      contextItem({ status: 'superseded', title: 'Redis-based cutover lock', validTo: stale }),
    ]);

    const { handoff } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      supersededWindowDays: 90,
      now: NOW,
    });

    expect(handoff.rendered).toContain('~~Redis-based cutover lock~~');
  });

  it('reports which items the artifact was built from, so §17 can carry them', async () => {
    const first = contextItem({ id: id('item0001') });
    const second = contextItem({ id: id('item0002'), kind: 'decision', title: 'Advisory locks' });
    const { store } = storeStub({}, [first, second]);

    const { itemIds } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(itemIds).toEqual([first.id, second.id]);
  });

  it('records which section each item landed in, so the artifact can be traced back', async () => {
    const constraint = contextItem({ id: id('item0001') });
    const decision = contextItem({
      id: id('item0002'),
      kind: 'decision',
      title: 'Advisory locks',
    });
    const gone = contextItem({
      id: id('item0003'),
      kind: 'decision',
      status: 'superseded',
      title: 'Redis lock',
      validTo: new Date(NOW.getTime() - 24 * 60 * 60 * 1000),
    });
    const { store, created } = storeStub({}, [constraint, decision, gone]);

    await assembleHandoff(store, { projectId: PROJECT_ID, nextAction: NEXT_ACTION, now: NOW });

    expect(created[0]?.items).toEqual([
      { itemId: constraint.id, section: 'Constraints (do not violate)' },
      { itemId: decision.id, section: 'Decisions and why' },
      { itemId: gone.id, section: 'Superseded recently (do not re-propose)' },
    ]);
  });

  it('does not record an item the render dropped, so the item set matches the prose', async () => {
    const stale = new Date(
      NOW.getTime() - (DEFAULT_SUPERSEDED_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000,
    );
    const { store, created } = storeStub({}, [
      contextItem({ id: id('item0001') }),
      contextItem({ id: id('item0004'), status: 'superseded', validTo: stale }),
    ]);

    const { itemIds } = await assembleHandoff(store, {
      projectId: PROJECT_ID,
      nextAction: NEXT_ACTION,
      now: NOW,
    });

    expect(created[0]?.items).toHaveLength(1);
    expect(itemIds).toEqual([id('item0001')]);
  });

  it('refuses a project this workspace cannot see', async () => {
    const { store } = storeStub({ getProject: vi.fn(async () => null) });

    await expect(
      assembleHandoff(store, { projectId: PROJECT_ID, nextAction: NEXT_ACTION, now: NOW }),
    ).rejects.toThrow(/found none/);
  });

  it('refuses a recipient who is not an actor in this workspace', async () => {
    const { store } = storeStub();

    await expect(
      assembleHandoff(store, {
        projectId: PROJECT_ID,
        toActor: id('stranger'),
        nextAction: NEXT_ACTION,
        now: NOW,
      }),
    ).rejects.toThrow(/leave the recipient unset to create an open handoff/);
  });

  it('refuses when the scoped actor no longer exists, rather than writing an unattributed handoff', async () => {
    const { store } = storeStub({ getActor: vi.fn(async () => null) });

    await expect(
      assembleHandoff(store, { projectId: PROJECT_ID, nextAction: NEXT_ACTION, now: NOW }),
    ).rejects.toThrow(/the token identifies an actor that has been removed/);
  });
});
