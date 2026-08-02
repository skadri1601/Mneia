import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { type IdentityError, resolveActor } from './identity.js';

const HUMAN_ACTOR = {
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  kind: 'human' as const,
  displayName: 'Ada Lovelace',
  externalRef: 'user_123',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

describe('resolveActor', () => {
  it('throws unauthenticated when the subject is null', async () => {
    const findActor = vi.fn();

    await expect(
      resolveActor({
        subject: null,
        workspaceId: HUMAN_ACTOR.workspaceId,
        findActor,
      }),
    ).rejects.toMatchObject({ code: 'unauthenticated' } satisfies Partial<IdentityError>);
    expect(findActor).not.toHaveBeenCalled();
  });

  it('throws account_not_found when the subject has no actor', async () => {
    const findActor = vi.fn().mockResolvedValue(null);

    await expect(
      resolveActor({
        subject: 'user_123',
        workspaceId: HUMAN_ACTOR.workspaceId,
        findActor,
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' } satisfies Partial<IdentityError>);
    expect(findActor).toHaveBeenCalledWith({
      subject: 'user_123',
      workspaceId: HUMAN_ACTOR.workspaceId,
    });
  });

  it('throws account_not_found when the actor is not human', async () => {
    const findActor = vi.fn().mockResolvedValue({ ...HUMAN_ACTOR, kind: 'agent' as const });

    await expect(
      resolveActor({
        subject: 'user_123',
        workspaceId: HUMAN_ACTOR.workspaceId,
        findActor,
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' } satisfies Partial<IdentityError>);
  });

  it('returns the human actor found for the subject', async () => {
    const findActor = vi.fn().mockResolvedValue(HUMAN_ACTOR);

    await expect(
      resolveActor({
        subject: 'user_123',
        workspaceId: HUMAN_ACTOR.workspaceId,
        findActor,
      }),
    ).resolves.toBe(HUMAN_ACTOR);
  });

  it('rejects an actor from a different workspace', async () => {
    const findActor = vi.fn().mockResolvedValue(HUMAN_ACTOR);

    await expect(
      resolveActor({
        subject: 'user_123',
        workspaceId: '33333333-3333-4333-8333-333333333333',
        findActor,
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' } satisfies Partial<IdentityError>);
  });

  it('rejects an actor mapped to a different external identity', async () => {
    const findActor = vi.fn().mockResolvedValue(HUMAN_ACTOR);

    await expect(
      resolveActor({
        subject: 'user_other',
        workspaceId: HUMAN_ACTOR.workspaceId,
        findActor,
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' } satisfies Partial<IdentityError>);
  });
});
