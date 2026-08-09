import type { ContextItem, Project } from '@mneia/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  readTimeline: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../../../server/browse-runtime.js', () => ({
  BROWSE_LIMIT: 200,
  readTimeline: mocks.readTimeline,
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import TimelinePage from './page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const ACCOUNT = {
  workspace: {
    id: WORKSPACE_ID,
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
    id: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'human',
    displayName: 'Ada Lovelace',
    externalRef: 'user_123',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  team: {
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  membership: {
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_ID,
    actorId: ACTOR_ID,
    role: 'lead',
    addedAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  workspaces: [{ id: WORKSPACE_ID, slug: 'acme', displayName: 'Acme' }],
} satisfies AccountContext;

const PROJECT = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  teamId: TEAM_ID,
  slug: 'analytical-engine',
  repoUrl: null,
  createdAt: new Date('2026-08-01T01:00:00.000Z'),
} satisfies Project;

const item = (
  overrides: Partial<ContextItem> & Pick<ContextItem, 'id' | 'title'>,
): ContextItem => ({
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  kind: 'decision',
  body: null,
  status: 'active',
  assertedBy: ACTOR_ID,
  assertedAt: new Date('2026-07-01T00:00:00.000Z'),
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.9,
  humanConfirmed: true,
  loadBearing: true,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: new Date('2026-07-01T00:00:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: 'team',
  embedding: null,
  embeddingModel: null,
  supersedeReason: null,
  ...overrides,
});

const RETIRED = item({
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Ship the migration runner first',
});

const CURRENT = item({
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Row-level security is mandatory',
});

const render = async (searchParams: Readonly<Record<string, string>> = {}): Promise<string> =>
  renderToStaticMarkup(
    await TimelinePage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

describe('TimelinePage', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.readTimeline.mockResolvedValue({
      project: PROJECT,
      believedThen: [RETIRED],
      believedNow: [CURRENT],
      truncated: false,
    });
    mocks.notFound.mockImplementation(() => {
      throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
    });
  });

  it('leads with the concise Timeline heading instead of a per-page project restatement', async () => {
    const html = await render({ asOf: '2026-07-15' });

    expect(html).toContain('<h1>Timeline</h1>');
    expect(html).toContain('2026-07-15');
    expect(html).not.toContain('Ada Lovelace');
    expect(html).not.toContain('What analytical-engine believed');
  });

  it('leaves the main landmark to the shared project shell', async () => {
    expect(await render()).not.toContain('<main');
  });

  it('keeps the as-of control and both belief sections intact', async () => {
    const html = await render({ asOf: '2026-07-15' });

    expect(html).toContain('name="asOf"');
    expect(html).toContain('type="date"');
    expect(html).toContain('Read that day');
    expect(html).toContain('Believed then — 1');
    expect(html).toContain('Believed since — 1');
    expect(html).toContain('Ship the migration runner first');
    expect(html).toContain('Row-level security is mandatory');
    expect(html).toContain('confirmed by a human');
  });

  it('keeps both empty states when the project believed nothing then or since', async () => {
    mocks.readTimeline.mockResolvedValue({
      project: PROJECT,
      believedThen: [],
      believedNow: [],
      truncated: false,
    });
    const html = await render();

    expect(html).toContain('Nothing had been recorded by then.');
    expect(html).toContain('Nothing has been added since.');
  });

  it('keeps the invalid-date alert and still reads today', async () => {
    const html = await render({ asOf: 'yesterday' });

    expect(html).toContain('role="alert"');
    expect(html).toContain('yesterday is not a date this page can read.');
  });

  it('keeps the truncation warning', async () => {
    mocks.readTimeline.mockResolvedValue({
      project: PROJECT,
      believedThen: [RETIRED],
      believedNow: [CURRENT],
      truncated: true,
    });

    expect(await render()).toContain('200-item ceiling');
  });

  it('does not distinguish a missing or cross-workspace project', async () => {
    mocks.readTimeline.mockResolvedValue({
      project: null,
      believedThen: [],
      believedNow: [],
      truncated: false,
    });

    await expect(render()).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
