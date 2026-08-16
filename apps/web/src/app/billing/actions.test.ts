import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountContext } from '../../server/store/account-store.js';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  snapshot: vi.fn(),
  createCheckoutSession: vi.fn(),
  createPortalSession: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('../../server/current-account.js', () => ({ getCurrentAccount: mocks.getCurrentAccount }));
vi.mock('../../server/billing/runtime.js', () => ({
  billingRuntime: () => ({
    store: { snapshot: mocks.snapshot },
    stripe: {
      createCheckoutSession: mocks.createCheckoutSession,
      createPortalSession: mocks.createPortalSession,
    },
    origin: 'https://app.mneia.dev',
  }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import { checkoutAction, portalAction } from './actions.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';

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

const form = (attemptToken = ATTEMPT): FormData => {
  const data = new FormData();
  data.set('attemptToken', attemptToken);
  return data;
};

describe('billing actions', () => {
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
    mocks.createCheckoutSession.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/c/pay/cs_1',
    });
    mocks.createPortalSession.mockResolvedValue({
      id: 'bps_1',
      url: 'https://billing.stripe.com/p/session/bps_1',
    });
  });

  it('reauthenticates and derives checkout state from the server, ignoring form fields other than its attempt token', async () => {
    const data = form();
    data.set('workspaceId', 'attacker-workspace');
    data.set('seats', '999');

    await checkoutAction(data);

    expect(mocks.getCurrentAccount).toHaveBeenCalledOnce();
    expect(mocks.snapshot).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WORKSPACE_ID, seats: 2, idempotencyKey: ATTEMPT }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_1');
  });

  it('redirects to the portal only when Stripe returned a hosted Stripe URL', async () => {
    mocks.snapshot.mockResolvedValue({
      workspaceId: WORKSPACE_ID,
      plan: 'solo',
      billingStatus: 'canceled',
      seatsPurchased: null,
      billingCustomerRef: 'cus_cancelled',
      memberCount: 2,
    });

    await portalAction(form());

    expect(mocks.createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_cancelled', idempotencyKey: ATTEMPT }),
    );
    expect(mocks.redirect).toHaveBeenCalledWith('https://billing.stripe.com/p/session/bps_1');
  });
});
