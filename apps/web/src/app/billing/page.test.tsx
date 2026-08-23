import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageReport } from '../../server/billing/usage.js';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  snapshot: vi.fn(),
  loadUsageReport: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({ getCurrentAccount: mocks.getCurrentAccount }));
vi.mock('../../server/billing/runtime.js', () => ({
  billingStore: () => ({ snapshot: mocks.snapshot }),
  billingRuntime: () => ({ store: { snapshot: mocks.snapshot } }),
}));
vi.mock('../../server/billing/usage-store.js', () => ({
  loadUsageReport: mocks.loadUsageReport,
}));
vi.mock('./actions.js', () => ({ checkoutAction: vi.fn(), portalAction: vi.fn() }));

import BillingPage from './page.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const ACCOUNT = {
  workspace: {
    id: WORKSPACE_ID,
    slug: 'acme',
    displayName: 'Acme',
    plan: 'solo',
    billingStatus: 'active',
    billingCustomerRef: null,
    seatsPurchased: null,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: new Date(),
  },
  actor: {
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: WORKSPACE_ID,
    kind: 'human',
    displayName: 'Ada',
    externalRef: 'user_1',
    createdAt: new Date(),
  },
  team: {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: WORKSPACE_ID,
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: new Date(),
  },
  membership: {
    workspaceId: WORKSPACE_ID,
    teamId: '44444444-4444-4444-8444-444444444444',
    actorId: '33333333-3333-4333-8333-333333333333',
    role: 'lead',
    addedAt: new Date(),
  },
  workspaces: [],
} satisfies AccountContext;

const USAGE: UsageReport = {
  plan: 'pro',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: { used: 223_040, allowance: 272_000, fraction: 0.82 },
  extractions: { used: 255, allowance: 1_700, fraction: 0.15 },
  embeddingTokens: { used: 1_234_567, allowance: 2_720_000, fraction: 0.45 },
  checkpoints: 300,
  percentUsed: 82,
  warn: true,
};

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAccount.mockResolvedValue(ACCOUNT);
    mocks.snapshot.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      billingCustomerRef: null,
      memberCount: 2,
    });
    mocks.loadUsageReport.mockResolvedValue(USAGE);
  });

  it('shows the trusted plan, status, and accepted seats with a lead-only checkout control', async () => {
    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.snapshot).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(html).toContain('Current plan');
    expect(html).toContain('Solo');
    expect(html).toContain('Accepted members');
    expect(html).toContain('2');
    expect(html).toContain('Start Team checkout');
    expect(html).not.toContain('$24');
  });

  it('gives members the facts but no billing controls', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      ...ACCOUNT,
      membership: { ...ACCOUNT.membership, role: 'member' },
    });

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Only a workspace lead can manage billing.');
    expect(html).not.toContain('Start Team checkout');
  });

  it('meters the workspace with one percentage, the checkpoints, and the reset date', async () => {
    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.loadUsageReport).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(html).toContain('Usage this period');
    expect(html).toContain('82%');
    expect(html).toContain('300');
    expect(html).toContain('2026-09-01');
    expect(html).toContain('Approaching the included allowance for this period.');
    expect(html).not.toMatch(/embedding/i);
  });

  it('still renders the usage section when the workspace cannot be metered', async () => {
    mocks.loadUsageReport.mockResolvedValue(null);

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('Usage this period');
    expect(html).toContain('Usage for this period is unavailable.');
    expect(html).toContain('Current plan');
  });

  it('renders a terse accessible return notice', async () => {
    const html = renderToStaticMarkup(
      await BillingPage({ searchParams: Promise.resolve({ checkout: 'success' }) }),
    );

    expect(html).toContain('Checkout completed.');
    expect(html).toContain('role="status"');
  });
});
