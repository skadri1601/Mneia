import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PendingReviewItem } from '@mneia/core';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  pendingReviewItems: vi.fn(),
  reviewPendingAction: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../../../server/current-account.js', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
}));
vi.mock('../../../../server/review-runtime.js', () => ({
  pendingReviewItems: mocks.pendingReviewItems,
}));
vi.mock('./actions.js', () => ({ reviewPendingAction: mocks.reviewPendingAction }));

import ReviewPage from './page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

const reviewStyles = readFileSync(
  resolve(process.cwd(), 'apps/web/src/app/projects/[projectId]/review/review.module.css'),
  'utf8',
);

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

const LOAD_BEARING = {
  id: '55555555-5555-4555-8555-555555555555',
  projectId: PROJECT_ID,
  kind: 'constraint',
  title: 'Row-level security is mandatory',
  body: 'Every tenant row carries workspace_id.',
  confidence: 0.82,
  loadBearing: true,
  accessScope: 'team',
  assertedBy: ACTOR_ID,
  assertedByKind: 'agent',
  assertedByName: 'Claude Code',
  assertedAt: new Date('2026-08-02T00:00:00.000Z'),
  sourceRef: null,
  originCheckpointId: null,
} satisfies PendingReviewItem;

const ORDINARY = {
  ...LOAD_BEARING,
  id: '66666666-6666-4666-8666-666666666666',
  title: 'Prefer the direct connection string',
  body: null,
  loadBearing: false,
} satisfies PendingReviewItem;

const render = async (searchParams: Readonly<Record<string, string>> = {}): Promise<string> =>
  renderToStaticMarkup(
    await ReviewPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

describe('ReviewPage', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.pendingReviewItems.mockResolvedValue([LOAD_BEARING, ORDINARY]);
  });

  it('leads with the concise Review queue heading and no per-page workspace restatement', async () => {
    const html = await render();

    expect(html).toContain('<h1>Review queue</h1>');
    expect(html).not.toContain('Ada Lovelace');
  });

  it('leaves the main landmark to the shared project shell', async () => {
    expect(await render()).not.toContain('<main');
  });

  it('keeps every pending item editable and applies them in one decision', async () => {
    const html = await render();

    expect(html).toContain(`value="${PROJECT_ID}"`);
    expect(html).toContain(`name="title:${LOAD_BEARING.id}"`);
    expect(html).toContain(`name="body:${LOAD_BEARING.id}"`);
    expect(html).toContain(`name="loadBearing:${LOAD_BEARING.id}"`);
    expect(html).toContain(`name="decision:${ORDINARY.id}"`);
    expect(html).toContain('Apply 2 decisions');
    expect(html).toContain('Claude Code (agent)');
    expect(html).toContain('confidence 0.82');
    expect(html).toContain('§10.1 requires a human to confirm it');
    expect(html).toContain('Asserted by an agent, so a human decides whether it is kept.');
  });

  it('keeps the empty state as real content rather than a loading state', async () => {
    mocks.pendingReviewItems.mockResolvedValue([]);
    const html = await render();

    expect(html).toContain('Nothing is waiting.');
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('<form');
  });

  it('keeps the reviewed notice and the error roles stable', async () => {
    expect(await render({ notice: 'reviewed', count: '2' })).toContain('role="status"');
    expect(await render({ notice: 'reviewed', count: '2' })).toContain('Reviewed 2 items.');
    expect(await render({ error: 'nothing_decided' })).toContain(
      'Nothing was decided, so nothing was written.',
    );
    expect(await render({ error: 'unmapped' })).toContain(
      'The review did not complete. Nothing was written.',
    );
    expect(await render({ error: 'unmapped' })).toContain('role="alert"');
  });

  it('styles the queue with defined tokens, a bounded empty state, and visible focus', () => {
    for (const undefinedToken of [
      '--tile-rule',
      '--radius-sm',
      '--radius-md',
      '--size-label',
      '--size-body-sm',
    ]) {
      expect(reviewStyles).not.toContain(undefinedToken);
    }

    expect(reviewStyles).toContain('--tile-hairline');
    expect(reviewStyles).toContain('--rounded-sm');
    expect(reviewStyles).toContain('--rounded-lg');
    expect(reviewStyles).toContain('--size-fine-print');
    expect(reviewStyles).toMatch(/\.empty \{[^}]*border: 1px solid var\(--tile-hairline\);/s);
    expect(reviewStyles).toMatch(/\.empty \{[^}]*border-radius: var\(--rounded-lg\);/s);
    expect(reviewStyles).toContain('overflow-wrap: anywhere;');
    expect(reviewStyles).toContain('min-width: 0;');
    expect(reviewStyles).toContain(':focus-visible');
    expect(reviewStyles).toContain('min-height: var(--target-min);');
  });
});
