import { describe, expect, it } from 'vitest';
import { ApiError, createHttpTransport } from './http.js';
import { createRemoteStore } from './remote-store.js';
import { CheckpointWriteWireSchema } from './wire.js';

const SCOPE = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actorId: '44444444-4444-4444-8444-444444444444',
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

const stub = (respond: (call: Call) => { status: number; body: unknown }) => {
  const calls: Call[] = [];

  const transport = createHttpTransport({
    endpoint: 'https://app.mneia.dev/',
    token: 's3cret',
    fetchImpl: async (url, init) => {
      const call: Call = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers as Record<string, string>,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const { status, body } = respond(call);
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  return { calls, store: createRemoteStore({ transport, scope: SCOPE }) };
};

describe('remote store transport', () => {
  it('sends optional client provenance when it opens a session', async () => {
    const sessionId = '55555555-5555-4555-8555-555555555555';
    const projectId = '33333333-3333-4333-8333-333333333333';
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        session: {
          id: sessionId,
          workspaceId: SCOPE.workspaceId,
          projectId,
          actorId: SCOPE.actorId,
          tool: 'mcp',
          clientName: 'codex',
          clientVersion: '1.2.3',
          clientSessionRef: '019c-session',
          clientSessionName: 'MNE-86 dogfood',
          clientSessionUrl: null,
          startedAt: '2026-08-16T10:00:00.000Z',
          endedAt: null,
        },
      },
    }));

    await store.createSession(projectId, 'mcp', {
      clientName: 'codex',
      clientVersion: '1.2.3',
      clientSessionRef: '019c-session',
      clientSessionName: 'MNE-86 dogfood',
    });

    expect(calls.at(0)?.body).toEqual({
      projectId,
      tool: 'mcp',
      clientName: 'codex',
      clientVersion: '1.2.3',
      clientSessionRef: '019c-session',
      clientSessionName: 'MNE-86 dogfood',
    });
  });

  it('sends the bearer token and trims the duplicate slash from the endpoint', async () => {
    const { calls, store } = stub(() => ({ status: 200, body: { actor: null } }));

    await store.getActor(SCOPE.actorId);

    expect(calls.at(0)?.url).toBe(`https://app.mneia.dev/api/v1/actors/${SCOPE.actorId}`);
    expect(calls.at(0)?.headers.authorization).toBe('Bearer s3cret');
  });

  it('writes a checkpoint without ever claiming an actor or a confirmation', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        result: {
          checkpoint: {
            id: '88888888-8888-4888-8888-888888888888',
            workspaceId: SCOPE.workspaceId,
            projectId: '33333333-3333-4333-8333-333333333333',
            sessionId: null,
            actorId: SCOPE.actorId,
            trigger: 'manual',
            createdAt: '2026-08-07T10:00:00.000Z',
            summary: null,
          },
          items: [],
          written: [],
        },
      },
    }));

    await store.writeCheckpoint({
      checkpoint: {
        projectId: '33333333-3333-4333-8333-333333333333',
        actorId: 'a-caller-supplied-actor',
        trigger: 'manual',
      },
      items: [
        {
          action: 'created',
          item: {
            projectId: '33333333-3333-4333-8333-333333333333',
            kind: 'decision',
            title: 'ship it',
            assertedBy: 'a-caller-supplied-actor',
            humanConfirmed: true,
          },
        },
      ],
    });

    const body = JSON.stringify(calls.at(0)?.body);
    expect(body).not.toContain('a-caller-supplied-actor');
    expect(body).not.toContain('humanConfirmed');
    expect(body).not.toContain('assertedBy');
  });

  it('sends the source watermark, which is the only record of how far extraction got', async () => {
    const projectId = '33333333-3333-4333-8333-333333333333';
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        result: {
          checkpoint: {
            id: '77777777-7777-4777-8777-777777777777',
            workspaceId: SCOPE.workspaceId,
            projectId,
            sessionId: null,
            actorId: SCOPE.actorId,
            trigger: 'manual',
            createdAt: '2026-08-07T10:00:00.000Z',
            summary: null,
          },
          items: [],
          written: [],
        },
      },
    }));

    await store.writeCheckpoint({
      checkpoint: {
        projectId,
        actorId: SCOPE.actorId,
        trigger: 'manual',
        source: 'claude-code',
        sourceSessionRef: 'session-1',
        sourceWatermark: 't41',
      },
      items: [],
    });

    // Dropping these three left checkpoint.source_watermark NULL on every hosted write, so
    // watermarkFor always answered null and every run re-extracted the whole session and
    // paid for it again (MNE-100). The server still resolves the actor from the token.
    const body = calls.at(0)?.body as { checkpoint: Record<string, unknown> } | undefined;
    expect(body?.checkpoint.sourceWatermark).toBe('t41');
    expect(body?.checkpoint.sourceSessionRef).toBe('session-1');
    expect(body?.checkpoint.source).toBe('claude-code');
    expect(JSON.stringify(body)).not.toContain(SCOPE.actorId);
  });

  it('sends conflictsWith, and the body it sends parses as the API schema', async () => {
    const projectId = '33333333-3333-4333-8333-333333333333';
    const contradicted = '99999999-9999-4999-8999-999999999999';
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        result: {
          checkpoint: {
            id: '77777777-7777-4777-8777-777777777777',
            workspaceId: SCOPE.workspaceId,
            projectId,
            sessionId: null,
            actorId: SCOPE.actorId,
            trigger: 'manual',
            createdAt: '2026-08-07T10:00:00.000Z',
            summary: null,
          },
          items: [],
          written: [],
        },
      },
    }));

    await store.writeCheckpoint({
      checkpoint: { projectId, actorId: SCOPE.actorId, trigger: 'manual' },
      items: [
        {
          action: 'superseded',
          item: {
            projectId,
            kind: 'decision',
            title: 'use Stripe after all',
            supersedesId: contradicted,
          },
          conflictsWith: contradicted,
        },
      ],
    });

    // Asserting what the body MUST CONTAIN, not only what it must not. This file checked
    // absence only, which is how both this and the source watermark shipped: a field the
    // encoder forgot is invisible to a negative assertion (MNE-100).
    const parsed = CheckpointWriteWireSchema.safeParse(calls.at(0)?.body);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.conflictsWith).toBe(contradicted);
    expect(parsed.success && parsed.data.items[0]?.item.supersedesId).toBe(contradicted);
  });

  it('surfaces a refused supersede as a typed error the caller can branch on', async () => {
    const { store } = stub(() => ({
      status: 409,
      body: {
        error: {
          code: 'supersede_refused',
          message: 'an agent may not replace a human-confirmed item',
        },
      },
    }));

    await expect(
      store.writeCheckpoint({
        checkpoint: { projectId: 'p', actorId: 'a', trigger: 'manual' },
        items: [],
      }),
    ).rejects.toMatchObject({ code: 'supersede_refused', status: 409 });
  });

  it('refuses a method the hosted API does not serve yet instead of failing silently', async () => {
    const { store } = stub(() => ({ status: 200, body: {} }));

    await expect(store.listOpenConflicts('p')).rejects.toBeInstanceOf(ApiError);
  });

  it('says the server is ahead of the client when a response does not parse', async () => {
    const { store } = stub(() => ({ status: 200, body: { actor: { id: 42 } } }));

    await expect(store.getActor(SCOPE.actorId)).rejects.toThrow(/newer API than this client/);
  });
});

const PROJECT = '33333333-3333-4333-8333-333333333333';
const ITEM = '11111111-1111-4111-8111-111111111111';
const CHECKPOINT = '66666666-6666-4666-8666-666666666666';

const itemWire = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM,
  workspaceId: SCOPE.workspaceId,
  projectId: PROJECT,
  kind: 'fact',
  title: 'the deploy gate fails closed on a stale schema',
  body: null,
  status: 'active',
  assertedBy: SCOPE.actorId,
  assertedAt: '2026-08-01T10:00:00.000Z',
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.9,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: 86_400_000,
  validFrom: '2026-08-01T10:00:00.000Z',
  validTo: null,
  supersedesId: null,
  supersededById: null,
  supersedeReason: null,
  accessScope: 'project',
  ...overrides,
});

describe('remote store re-verification', () => {
  it('asks the hosted API for the stale list and decodes the instants', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        items: [
          {
            item: itemWire(),
            staleSince: '2026-08-02T10:00:00.000Z',
            staleForMs: 432_000_000,
          },
        ],
      },
    }));

    const stale = await store.listStaleContextItems({
      projectId: PROJECT,
      asOf: new Date('2026-08-07T10:00:00.000Z'),
      limit: 10,
    });

    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/items/stale');
    expect(calls[0]?.body).toEqual({
      projectId: PROJECT,
      asOf: '2026-08-07T10:00:00.000Z',
      limit: 10,
    });
    expect(stale[0]?.staleSince).toEqual(new Date('2026-08-02T10:00:00.000Z'));
    expect(stale[0]?.staleForMs).toBe(432_000_000);
    expect(stale[0]?.item.id).toBe(ITEM);
  });

  it('omits asOf and limit when the caller gave neither', async () => {
    const { calls, store } = stub(() => ({ status: 200, body: { items: [] } }));

    await store.listStaleContextItems({ projectId: PROJECT });

    expect(calls[0]?.body).toEqual({ projectId: PROJECT });
  });

  it('posts a verification and decodes the result', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        checkpoint: {
          id: CHECKPOINT,
          workspaceId: SCOPE.workspaceId,
          projectId: PROJECT,
          sessionId: null,
          actorId: SCOPE.actorId,
          trigger: 'manual',
          createdAt: '2026-08-07T10:00:00.000Z',
          summary: 'Re-verified: still holds',
        },
        item: itemWire({ humanConfirmed: true, lastVerifiedAt: '2026-08-07T10:00:00.000Z' }),
        verification: 'confirmed',
        previousLastVerifiedAt: '2026-08-02T10:00:00.000Z',
      },
    }));

    const result = await store.verifyContextItem({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'confirmed',
    });

    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/items/verify');
    expect(calls[0]?.body).toEqual({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'confirmed',
    });
    expect(result.verification).toBe('confirmed');
    expect(result.item.humanConfirmed).toBe(true);
    expect(result.previousLastVerifiedAt).toEqual(new Date('2026-08-02T10:00:00.000Z'));
    expect(result.checkpoint.id).toBe(CHECKPOINT);
  });

  it('sends the reason with a denial', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        checkpoint: {
          id: CHECKPOINT,
          workspaceId: SCOPE.workspaceId,
          projectId: PROJECT,
          sessionId: null,
          actorId: SCOPE.actorId,
          trigger: 'manual',
          createdAt: '2026-08-07T10:00:00.000Z',
          summary: 'Verification denied: we moved off Redis',
        },
        item: itemWire({ status: 'retired', validTo: '2026-08-07T10:00:00.000Z' }),
        verification: 'denied',
        previousLastVerifiedAt: null,
      },
    }));

    const result = await store.verifyContextItem({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'denied',
      reason: 'we moved off Redis',
    });

    expect(calls[0]?.body).toEqual({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'denied',
      reason: 'we moved off Redis',
    });
    expect(result.item.status).toBe('retired');
    expect(result.previousLastVerifiedAt).toBeNull();
  });
});

const ACTOR_OTHER = '66666666-6666-4666-8666-666666666666';
const HANDOFF = '77777777-7777-4777-8777-777777777777';
const SESSION = '88888888-8888-4888-8888-888888888888';

const actorWire = (id: string, displayName: string) => ({
  id,
  workspaceId: SCOPE.workspaceId,
  kind: 'human' as const,
  displayName,
  externalRef: null,
  createdAt: '2026-08-01T09:00:00.000Z',
});

describe('remote store multiplayer reads', () => {
  it('asks the hosted API for the inbox rather than every open handoff', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        handoffs: [
          {
            id: HANDOFF,
            workspaceId: SCOPE.workspaceId,
            projectId: PROJECT,
            fromActor: ACTOR_OTHER,
            toActor: SCOPE.actorId,
            createdAt: '2026-08-20T10:00:00.000Z',
            receivedAt: null,
            nextAction: 'Wire the retry path',
            rendered: '# Handoff',
          },
        ],
      },
    }));

    const inbox = await store.listInboxHandoffs({ projectId: PROJECT, limit: 5 });

    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/handoff/inbox');
    expect(calls[0]?.body).toEqual({ project: PROJECT, limit: 5 });
    expect(inbox[0]?.toActor).toBe(SCOPE.actorId);
    expect(inbox[0]?.createdAt).toEqual(new Date('2026-08-20T10:00:00.000Z'));
  });

  it('asks the hosted API for the workspace roster, and omits a limit it was not given', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: { actors: [actorWire(ACTOR_OTHER, 'Alice'), actorWire(SCOPE.actorId, 'Bob')] },
    }));

    const actors = await store.listWorkspaceActors();

    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/actors/list');
    expect(calls[0]?.body).toEqual({});
    expect(actors.map((actor) => actor.displayName)).toEqual(['Alice', 'Bob']);
    expect(actors[0]?.kind).toBe('human');
  });

  it('decodes a project session summary with its actor and its counts', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        sessions: [
          {
            session: {
              id: SESSION,
              workspaceId: SCOPE.workspaceId,
              projectId: PROJECT,
              actorId: ACTOR_OTHER,
              tool: 'claude-code',
              clientName: 'claude-code',
              clientVersion: '2.0.1',
              clientSessionRef: '019c-session',
              clientSessionName: 'MNE-135 lane C',
              clientSessionUrl: null,
              startedAt: '2026-08-20T09:00:00.000Z',
              endedAt: null,
            },
            actor: actorWire(ACTOR_OTHER, 'Alice'),
            checkpointCount: 3,
            itemCount: 11,
          },
        ],
      },
    }));

    const sessions = await store.listProjectSessions({ projectId: PROJECT, limit: 20 });

    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/sessions/list');
    expect(calls[0]?.body).toEqual({ project: PROJECT, limit: 20 });
    expect(sessions[0]?.actor.displayName).toBe('Alice');
    expect(sessions[0]?.session.clientSessionName).toBe('MNE-135 lane C');
    expect(sessions[0]?.session.startedAt).toEqual(new Date('2026-08-20T09:00:00.000Z'));
    expect(sessions[0]?.checkpointCount).toBe(3);
    expect(sessions[0]?.itemCount).toBe(11);
  });

  it('reads the pending review queue over GET, so the CLI and the web app share one route', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        items: [
          {
            id: ITEM,
            projectId: PROJECT,
            kind: 'decision',
            title: 'Postgres RLS is mandatory',
            body: 'shared schema, workspace_id on every row',
            confidence: 0.8,
            loadBearing: true,
            accessScope: 'project',
            assertedBy: ACTOR_OTHER,
            assertedByKind: 'agent',
            assertedByName: 'lane C agent',
            assertedAt: '2026-08-20T09:00:00.000Z',
            sourceRef: 'vision.md §11.3',
            originCheckpointId: CHECKPOINT,
          },
        ],
      },
    }));

    const items = await store.listPendingReviewItems({ projectId: PROJECT, limit: 20 });

    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe(
      `https://app.mneia.dev/api/v1/review/pending?projectId=${PROJECT}&limit=20`,
    );
    expect(items[0]?.assertedAt).toEqual(new Date('2026-08-20T09:00:00.000Z'));
    expect(items[0]?.assertedByKind).toBe('agent');
    expect(items[0]?.originCheckpointId).toBe(CHECKPOINT);
  });

  it('submits a review over POST and never sends human_confirmed or asserted_by', async () => {
    const { calls, store } = stub(() => ({
      status: 200,
      body: {
        result: {
          checkpoint: {
            id: CHECKPOINT,
            workspaceId: SCOPE.workspaceId,
            projectId: PROJECT,
            sessionId: null,
            actorId: SCOPE.actorId,
            trigger: 'manual',
            createdAt: '2026-08-20T10:00:00.000Z',
            summary: '1 confirmed',
          },
          outcomes: [{ itemId: ITEM, outcome: 'edited', fieldsChanged: ['title'] }],
        },
      },
    }));

    const result = await store.reviewPendingItems({
      projectId: PROJECT,
      reviews: [{ itemId: ITEM, decision: 'accept', title: 'RLS is mandatory', loadBearing: true }],
      summary: '1 confirmed',
    });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://app.mneia.dev/api/v1/review');
    expect(calls[0]?.body).toEqual({
      projectId: PROJECT,
      reviews: [{ itemId: ITEM, decision: 'accept', title: 'RLS is mandatory', loadBearing: true }],
      summary: '1 confirmed',
    });
    expect(JSON.stringify(calls[0]?.body)).not.toMatch(/human_?[Cc]onfirmed|asserted_?[Bb]y/);
    expect(result.checkpoint.createdAt).toEqual(new Date('2026-08-20T10:00:00.000Z'));
    expect(result.outcomes[0]?.outcome).toBe('edited');
  });
});
