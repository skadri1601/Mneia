import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewCapableStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => {
  const seen: string[] = [];
  return {
    seen,
    record: async (_store: unknown, id: string) => {
      seen.push(id);
      return {};
    },
  };
});

vi.mock('server-only', () => ({}));

// serve is replaced so a route runs without auth, rate limiting or a store, but parseResourceId
// stays real — it is the thing under test.
vi.mock('../../../server/api/serve.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../server/api/serve.js')>()),
  serve: async (options: {
    input: string;
    run: (store: ReviewCapableStore, input: string) => Promise<unknown>;
  }) => {
    await options.run({} as ReviewCapableStore, options.input);
    return new Response(null);
  },
}));

vi.mock('../../../server/api/handlers.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../server/api/handlers.js')>()),
  handleGetItem: shared.record,
  handleGetActor: shared.record,
  handleGetProject: shared.record,
}));

vi.mock('../../../server/api/handoff.js', () => ({
  handleGetHandoff: shared.record,
  handleListHandoffItems: shared.record,
}));

import * as actorsById from './actors/[id]/route.js';
import * as handoffItems from './handoff/[id]/items/route.js';
import * as handoffById from './handoff/[id]/route.js';
import * as itemsById from './items/[id]/route.js';
import * as projectsById from './projects/[id]/route.js';

type RouteModule = {
  GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
};

// Every route that takes an id from the URL path. A new one must be added here, and the first
// test below fails until it is — that is what stops the parse step from being remembered per route.
const ID_ROUTES: Readonly<Record<string, RouteModule>> = {
  'actors/[id]/route.ts': actorsById,
  'handoff/[id]/items/route.ts': handoffItems,
  'handoff/[id]/route.ts': handoffById,
  'items/[id]/route.ts': itemsById,
  'projects/[id]/route.ts': projectsById,
};

const V1 = join(process.cwd(), 'apps/web/src/app/api/v1');

function routeFilesUnderDynamicSegments(dir: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...routeFilesUnderDynamicSegments(join(dir, entry.name), rel));
    } else if (entry.name === 'route.ts' && prefix.includes('[')) {
      found.push(rel);
    }
  }
  return found;
}

const request = new Request('https://app.mneia.dev/api/v1/whatever');

const callRoute = (route: RouteModule, id: string): Promise<Response> =>
  route.GET(request, { params: Promise.resolve({ id }) });

describe('routes that take an id from the path', () => {
  it('names every one of them, so a new dynamic route cannot skip the parse unnoticed', () => {
    expect(routeFilesUnderDynamicSegments(V1).sort()).toEqual(Object.keys(ID_ROUTES).sort());
  });

  for (const [name, route] of Object.entries(ID_ROUTES)) {
    describe(name, () => {
      it('refuses a segment that is not a UUID, before the handler is reached', async () => {
        shared.seen.length = 0;

        await expect(callRoute(route, '../../../etc/passwd')).rejects.toMatchObject({
          code: 'invalid_request',
        });
        await expect(callRoute(route, 'not-a-uuid')).rejects.toThrow(
          /in the path to be a UUID; received "not-a-uuid" — pass the id exactly as the API returned it/,
        );

        expect(shared.seen).toEqual([]);
      });

      it('passes a well-formed id through untouched', async () => {
        shared.seen.length = 0;
        const id = '66666666-1111-4111-8111-111111111111';

        await expect(callRoute(route, id)).resolves.toBeInstanceOf(Response);
        expect(shared.seen).toEqual([id]);
      });
    });
  }
});
