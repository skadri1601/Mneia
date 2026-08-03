import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ clerkClient: async () => ({}) }));

import { createInvitationWith, InvitationError } from './invitations.js';

const request = { emailAddress: 'ada@example.com', redirectUrl: 'https://app.mneia.dev/welcome' };

describe('createInvitationWith', () => {
  it('suppresses Clerk’s own email so ours is the only one sent', async () => {
    let notify: boolean | undefined;

    await createInvitationWith(async (input) => {
      notify = input.notify;
      return { id: 'inv_1', url: 'https://accounts.mneia.dev/accept' };
    }, request);

    expect(notify).toBe(false);
  });

  it('returns the acceptance URL for our email to carry', async () => {
    const invitation = await createInvitationWith(
      async () => ({ id: 'inv_1', url: 'https://accounts.mneia.dev/accept' }),
      request,
    );

    expect(invitation).toEqual({ id: 'inv_1', url: 'https://accounts.mneia.dev/accept' });
  });

  it('fails loudly when Clerk returns no URL, rather than emailing nothing', async () => {
    await expect(
      createInvitationWith(async () => ({ id: 'inv_1' }), request),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it('names the address when Clerk refuses', async () => {
    await expect(
      createInvitationWith(async () => {
        throw new Error('rate limited');
      }, request),
    ).rejects.toThrow(/ada@example.com/);
  });
});
