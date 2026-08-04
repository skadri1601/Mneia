import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { admitSignup } from './admission.js';
import type { AdmissionStore } from './store/admission-store.js';

const approved = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  unsubscribeToken: '22222222-2222-4222-8222-222222222222',
};

const buildStore = (overrides: Partial<AdmissionStore> = {}): AdmissionStore => ({
  listPending: async () => [],
  approve: async () => approved,
  recordInvitation: async () => undefined,
  claimSend: async () => 'claim-1',
  settleSend: async () => undefined,
  ...overrides,
});

const invitation = { id: 'inv_1', url: 'https://accounts.mneia.dev/accept?ticket=abc' };

const delivered = async () => ({ delivered: true, providerId: 'resend-1', detail: null });

describe('admitSignup', () => {
  it('approves, invites, then emails the invitation link', async () => {
    const calls: string[] = [];
    const store = buildStore({
      approve: async () => {
        calls.push('approve');
        return approved;
      },
      recordInvitation: async () => {
        calls.push('record');
      },
      claimSend: async () => {
        calls.push('claim');
        return 'claim-1';
      },
      settleSend: async () => {
        calls.push('settle');
      },
    });

    const result = await admitSignup({
      signupId: approved.id,
      approvedBy: 'user_admin',
      store,
      createInvitation: async () => {
        calls.push('invite');
        return invitation;
      },
      deliver: delivered,
      welcomeUrl: 'https://app.mneia.dev/welcome',
    });

    expect(result.outcome).toBe('invited');
    expect(calls).toEqual(['approve', 'invite', 'record', 'claim', 'settle']);
  });

  it('marks the approval before creating the invitation, so a failure is retryable', async () => {
    const store = buildStore();
    let approvedFirst = false;

    await expect(
      admitSignup({
        signupId: approved.id,
        approvedBy: 'user_admin',
        store: {
          ...store,
          approve: async () => {
            approvedFirst = true;
            return approved;
          },
        },
        createInvitation: async () => {
          throw new Error('Clerk is down');
        },
        deliver: delivered,
        welcomeUrl: 'https://app.mneia.dev/welcome',
      }),
    ).rejects.toThrow('Clerk is down');

    expect(approvedFirst).toBe(true);
  });

  it('sends the invitation link, not a password', async () => {
    let sentText = '';

    await admitSignup({
      signupId: approved.id,
      approvedBy: 'user_admin',
      store: buildStore(),
      createInvitation: async () => invitation,
      deliver: async ({ text }) => {
        sentText = text;
        return { delivered: true, providerId: null, detail: null };
      },
      welcomeUrl: 'https://app.mneia.dev/welcome',
    });

    expect(sentText).toContain(invitation.url);
    expect(sentText.toLowerCase()).not.toContain('password');
  });

  it('points the invitation at the onboarding step', async () => {
    let redirectUrl = '';

    await admitSignup({
      signupId: approved.id,
      approvedBy: 'user_admin',
      store: buildStore(),
      createInvitation: async (request) => {
        redirectUrl = request.redirectUrl;
        return invitation;
      },
      deliver: delivered,
      welcomeUrl: 'https://app.mneia.dev/welcome',
    });

    expect(redirectUrl).toBe('https://app.mneia.dev/welcome');
  });

  it('never sends a second email when the ledger already holds a claim', async () => {
    let deliveries = 0;

    const result = await admitSignup({
      signupId: approved.id,
      approvedBy: 'user_admin',
      store: buildStore({ claimSend: async () => null }),
      createInvitation: async () => invitation,
      deliver: async () => {
        deliveries += 1;
        return { delivered: true, providerId: null, detail: null };
      },
      welcomeUrl: 'https://app.mneia.dev/welcome',
    });

    expect(result.outcome).toBe('already_emailed');
    expect(deliveries).toBe(0);
  });

  it('records an undelivered send as unresolved rather than sent', async () => {
    let settled: { delivered: boolean } | undefined;

    const result = await admitSignup({
      signupId: approved.id,
      approvedBy: 'user_admin',
      store: buildStore({
        settleSend: async (input) => {
          settled = { delivered: input.delivered };
        },
      }),
      createInvitation: async () => invitation,
      deliver: async () => ({
        delivered: false,
        providerId: null,
        detail: 'Resend returned 500 Internal Server Error',
      }),
      welcomeUrl: 'https://app.mneia.dev/welcome',
    });

    expect(result.outcome).toBe('invited_without_email');
    expect(settled?.delivered).toBe(false);
  });
});
