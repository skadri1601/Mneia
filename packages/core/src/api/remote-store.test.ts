import { describe, expect, it } from 'vitest';
import { ApiError, createHttpTransport } from './http.js';
import { createRemoteStore } from './remote-store.js';

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
