import { readFileSync } from 'node:fs';
import type { ContextItem, Project } from '@mneia/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  browseDecisions: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../../../server/browse-runtime.js', () => ({
  BROWSE_LIMIT: 200,
  browseDecisions: mocks.browseDecisions,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import DecisionsPage from './page.js';

const ACCOUNT = {
  workspace: {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'workspace-ada',
    displayName: 'Ada Lovelace',
    plan: 'solo',
    billingStatus: 'active',
    billingCustomerRef: null,
    seatsPurchased: null,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  actor: {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    kind: 'human',
    displayName: 'Ada Lovelace',
    externalRef: 'user_123',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  team: {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  membership: {
    workspaceId: '11111111-1111-4111-8111-111111111111',
    teamId: '33333333-3333-4333-8333-333333333333',
    actorId: '22222222-2222-4222-8222-222222222222',
    role: 'lead',
    addedAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  workspaces: [{ id: '11111111-1111-4111-8111-111111111111', slug: 'acme', displayName: 'Acme' }],
} satisfies AccountContext;

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const PROJECT = {
  id: PROJECT_ID,
  workspaceId: ACCOUNT.workspace.id,
  teamId: ACCOUNT.team.id,
  slug: 'analytical-engine',
  repoUrl: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
} satisfies Project;

const ITEM = {
  id: '55555555-5555-4555-8555-555555555555',
  workspaceId: ACCOUNT.workspace.id,
  projectId: PROJECT_ID,
  kind: 'decision',
  title: 'Postgres is the only store',
  body: 'One dependency keeps BYOC a conversation rather than a project.',
  status: 'active',
  assertedBy: ACCOUNT.actor.id,
  assertedAt: new Date('2026-08-03T00:00:00.000Z'),
  sourceSessionId: null,
  sourceRef: 'commit:9bd320d',
  confidence: 0.92,
  humanConfirmed: true,
  loadBearing: true,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: new Date('2026-08-03T00:00:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'team',
  embedding: null,
  embeddingModel: null,
  supersedeReason: null,
} satisfies ContextItem;

const render = async (query: Record<string, string> = {}): Promise<string> =>
  renderToStaticMarkup(
    await DecisionsPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve(query),
    }),
  );

describe('DecisionsPage', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.browseDecisions.mockResolvedValue({
      project: PROJECT,
      items: [ITEM],
      truncated: false,
    });
  });

  it('titles the section Decisions without repeating workspace orientation', async () => {
    const html = await render();

    expect(html).toContain('<h1>Decisions</h1>');
    expect(html).not.toContain('Decisions in analytical-engine');
    expect(html).not.toContain('Ada Lovelace');
  });

  it('renders no main landmark because the shell owns it', async () => {
    expect(await render()).not.toContain('<main');
  });

  it('keeps every existing filter control', async () => {
    const html = await render({ kind: 'decision', status: 'superseded', q: 'postgres' });

    expect(html).toContain('name="kind"');
    expect(html).toContain('name="status"');
    expect(html).toContain('name="q"');
    expect(html).toContain('name="loadBearing"');
    expect(html).toContain('Load-bearing only');
    expect(html).toContain('Apply');
  });

  it('reads the store with the scoped filters it was given', async () => {
    await render({ kind: 'decision', loadBearing: 'true', q: '  postgres  ' });

    expect(mocks.browseDecisions).toHaveBeenCalledWith(
      { workspaceId: ACCOUNT.workspace.id, actorId: ACCOUNT.actor.id },
      {
        projectId: PROJECT_ID,
        kinds: ['decision'],
        statuses: ['active'],
        loadBearing: true,
        text: 'postgres',
      },
    );
  });

  it('renders a populated decision with its provenance', async () => {
    const html = await render();

    expect(html).toContain('1 item');
    expect(html).toContain('Postgres is the only store');
    expect(html).toContain('load-bearing');
    expect(html).toContain('confirmed by a human');
    expect(html).toContain('confidence 0.92');
    expect(html).toContain('commit:9bd320d');
  });

  it('renders the empty state when nothing matches', async () => {
    mocks.browseDecisions.mockResolvedValue({ project: PROJECT, items: [], truncated: false });

    const html = await render();

    expect(html).toContain('No items match.');
    expect(html).toContain('Items arrive from a checkpoint.');
  });

  it('does not distinguish a missing or cross-workspace project', async () => {
    mocks.browseDecisions.mockResolvedValue({ project: null, items: [], truncated: false });

    await render();

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it('styles itself with defined design tokens only', () => {
    const css = readFileSync(new URL('../browse.module.css', import.meta.url), 'utf8');

    for (const token of [
      '--tile-rule',
      '--radius-sm',
      '--radius-md',
      '--size-label',
      '--size-body-sm',
    ]) {
      expect(css).not.toContain(token);
    }
  });

  it('contains long titles and bodies rather than scrolling the page', () => {
    const css = readFileSync(new URL('../browse.module.css', import.meta.url), 'utf8');

    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('min-width: 0');
  });
});
