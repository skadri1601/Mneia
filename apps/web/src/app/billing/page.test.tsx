import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  snapshot: vi.fn(),
  subscriptionRef: vi.fn(),
  quotaFor: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({ getCurrentAccount: mocks.getCurrentAccount }));
vi.mock('../../server/billing/runtime.js', () => ({
  billingStore: () => ({ snapshot: mocks.snapshot, subscriptionRef: mocks.subscriptionRef }),
  billingRuntime: () => ({
    store: { snapshot: mocks.snapshot, subscriptionRef: mocks.subscriptionRef },
  }),
  quotaStore: () => ({ quotaFor: mocks.quotaFor }),
}));
vi.mock('./actions.js', () => ({
  checkoutAction: vi.fn(),
  portalAction: vi.fn(),
  purchaseSeatsAction: vi.fn(),
}));

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
    mocks.subscriptionRef.mockResolvedValue({ subscriptionRef: null, itemRef: null });
    mocks.quotaFor.mockResolvedValue({
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      memberCount: 2,
      turnAllowance: null,
      extractionAllowance: null,
      embeddingTokenAllowance: null,
      turnsUsed: 12_800,
      extractionsUsed: 80,
      embeddingTokensUsed: 0,
      walletBalanceMicros: 0,
      period: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
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

  it('meters every dial against the allowance the API will actually enforce', async () => {
    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(mocks.quotaFor).toHaveBeenCalledWith(WORKSPACE_ID, expect.any(Date));
    expect(html).toContain('80 of 400');
    expect(html).toContain('12,800 of 64,000');
    expect(html).toContain('Prepaid balance');
    expect(html).toContain('$0.00');
    expect(html).toContain('September 1, 2026');
  });

  it('does not report seats a workspace never purchased', async () => {
    // The label used to render memberCount, which told an unsubscribed workspace it had
    // two seats it had never bought.
    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('None purchased');
  });

  it('pools a team allowance across purchased seats rather than showing the per-seat figure', async () => {
    mocks.snapshot.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 3,
      billingCustomerRef: 'cus_1',
      memberCount: 2,
    });
    mocks.quotaFor.mockResolvedValue({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 3,
      memberCount: 2,
      turnAllowance: null,
      extractionAllowance: null,
      embeddingTokenAllowance: null,
      turnsUsed: 0,
      extractionsUsed: 100,
      embeddingTokensUsed: 0,
      walletBalanceMicros: 250_000,
      period: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('100 of 8,400');
    expect(html).toContain('2 of 3 purchased');
    expect(html).toContain('$0.25');
  });

  it('says unmetered rather than zero for a plan with no ceiling', async () => {
    mocks.quotaFor.mockResolvedValue({
      plan: 'enterprise',
      billingStatus: 'active',
      seatsPurchased: null,
      memberCount: 2,
      turnAllowance: null,
      extractionAllowance: null,
      embeddingTokenAllowance: null,
      turnsUsed: 5,
      extractionsUsed: 5,
      embeddingTokensUsed: 0,
      walletBalanceMicros: 0,
      period: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
    });

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('5 used — unmetered');
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

  it('renders a terse accessible return notice', async () => {
    const html = renderToStaticMarkup(
      await BillingPage({ searchParams: Promise.resolve({ checkout: 'success' }) }),
    );

    expect(html).toContain('Checkout completed.');
    expect(html).toContain('role="status"');
  });

  describe('the seat control', () => {
    const teamSnapshot = {
      workspaceId: WORKSPACE_ID,
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 3,
      billingCustomerRef: 'cus_1',
      memberCount: 2,
    };

    it('offers a seat control once the subscription reference is recorded', async () => {
      mocks.snapshot.mockResolvedValue(teamSnapshot);
      mocks.subscriptionRef.mockResolvedValue({ subscriptionRef: 'sub_1', itemRef: 'si_1' });

      const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

      expect(html).toContain('Update seat count');
      expect(html).toContain('name="seats"');
      // Never below the accepted members, or quota.ts refuses every checkpoint with
      // seats_exceeded until someone notices.
      expect(html).toContain('min="2"');
    });

    it.each([
      ['the item reference', { subscriptionRef: 'sub_1', itemRef: null }],
      ['the subscription reference', { subscriptionRef: null, itemRef: 'si_1' }],
      ['both references', { subscriptionRef: null, itemRef: null }],
    ])('explains itself rather than showing a dead control when %s is missing', async (_, ref) => {
      // Existing subscribers carry null refs until their next Stripe event (migration
      // 0036). A control that silently fails is worse than an absent one, and an empty
      // panel would read as a bug.
      mocks.snapshot.mockResolvedValue(teamSnapshot);
      mocks.subscriptionRef.mockResolvedValue(ref);

      const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

      expect(html).not.toContain('Update seat count');
      expect(html).toContain('Seat changes are not available yet');
      expect(html).toContain('lifecycle event');
    });

    it('offers no seat control on a plan that is not seat-priced', async () => {
      // Pro is one seat by definition and Solo buys none, so there is no quantity to move.
      mocks.snapshot.mockResolvedValue({ ...teamSnapshot, plan: 'pro' });
      mocks.subscriptionRef.mockResolvedValue({ subscriptionRef: 'sub_1', itemRef: 'si_1' });

      const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

      expect(html).not.toContain('Update seat count');
      expect(html).not.toContain('Seat changes are not available yet');
    });

    it('gives a member no seat control, and does not tease one', async () => {
      mocks.snapshot.mockResolvedValue(teamSnapshot);
      mocks.subscriptionRef.mockResolvedValue({ subscriptionRef: 'sub_1', itemRef: 'si_1' });
      mocks.getCurrentAccount.mockResolvedValue({
        ...ACCOUNT,
        membership: { ...ACCOUNT.membership, role: 'member' },
      });

      const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

      expect(html).not.toContain('Update seat count');
      expect(html).not.toContain('Seat changes are not available yet');
    });

    it.each([
      ['updated', 'Seat count updated.'],
      ['unchanged', 'No seat change was applied'],
    ])('reports a %s outcome on return', async (seats, expected) => {
      mocks.snapshot.mockResolvedValue(teamSnapshot);
      mocks.subscriptionRef.mockResolvedValue({ subscriptionRef: 'sub_1', itemRef: 'si_1' });

      const html = renderToStaticMarkup(
        await BillingPage({ searchParams: Promise.resolve({ seats }) }),
      );

      expect(html).toContain(expected);
      expect(html).toContain('role="status"');
    });
  });
});
