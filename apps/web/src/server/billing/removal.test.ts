import type { WorkspaceRole } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { decideRemoval, decideRoleChange } = await import('./seats.js');

const OWNER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MEMBER_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const MEMBER_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const party = (actorId: string, workspaceRole: WorkspaceRole) => ({
  actorId,
  workspaceRole,
  displayName: `${workspaceRole}-${actorId.slice(0, 4)}`,
});

/** Two owners by default, so the last-owner guard is not what any given case is testing. */
const decide = (
  remover: ReturnType<typeof party>,
  target: ReturnType<typeof party>,
  ownerCount = 2,
) => decideRemoval({ remover, target, ownerCount });

describe('decideRemoval — the last owner', () => {
  it('refuses removing the only owner', () => {
    const decision = decide(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('last_owner');
  });

  it('refuses the only owner removing themselves, which is the same orphaning', () => {
    const decision = decide(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.message).toContain('another owner');
  });

  it('refuses an owner removing the only other owner even when they are also an owner', () => {
    // ownerCount 1 cannot happen with two distinct owners, but the guard must not depend on
    // the caller getting the count right relative to the target.
    const decision = decide(party(OWNER_A, 'owner'), party(OWNER_B, 'owner'), 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('last_owner');
  });

  it('allows an owner to leave once a second owner exists', () => {
    expect(decide(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 2)).toEqual({
      permitted: true,
      selfRemoval: true,
    });
  });

  it('does not block removing a non-owner just because there is one owner', () => {
    expect(decide(party(OWNER_A, 'owner'), party(MEMBER_A, 'member'), 1)).toEqual({
      permitted: true,
      selfRemoval: false,
    });
  });
});

describe('decideRemoval — self removal', () => {
  it.each(['owner', 'admin', 'member'] as const)('lets a %s leave', (role) => {
    expect(decide(party(MEMBER_A, role), party(MEMBER_A, role))).toEqual({
      permitted: true,
      selfRemoval: true,
    });
  });

  it('marks it as a self removal, so the caller can redirect away from the workspace', () => {
    const decision = decide(party(MEMBER_A, 'member'), party(MEMBER_A, 'member'));

    expect(decision.permitted).toBe(true);
    if (!decision.permitted) return;
    expect(decision.selfRemoval).toBe(true);
  });
});

describe('decideRemoval — who may remove whom', () => {
  it.each([
    { remover: 'owner', target: 'owner' },
    { remover: 'owner', target: 'admin' },
    { remover: 'owner', target: 'member' },
    { remover: 'admin', target: 'member' },
  ] as const)('permits a $remover removing a $target', ({ remover, target }) => {
    expect(decide(party(OWNER_A, remover), party(MEMBER_B, target))).toEqual({
      permitted: true,
      selfRemoval: false,
    });
  });

  it.each([
    { remover: 'member', target: 'owner' },
    { remover: 'member', target: 'admin' },
    { remover: 'member', target: 'member' },
    { remover: 'admin', target: 'owner' },
    { remover: 'admin', target: 'admin' },
  ] as const)('refuses a $remover removing a $target', ({ remover, target }) => {
    const decision = decide(party(MEMBER_A, remover), party(ADMIN_B, target));

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('not_permitted');
  });

  it('names both roles and what to do instead, rather than just saying no', () => {
    const decision = decide(party(MEMBER_A, 'member'), party(ADMIN_A, 'admin'));

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.message).toContain('member');
    expect(decision.message).toContain('admin');
    expect(decision.message).toContain('Ask an owner');
  });

  it('does not let an admin eject a peer admin, which would make the role a race', () => {
    const decision = decide(party(ADMIN_A, 'admin'), party(ADMIN_B, 'admin'));

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('not_permitted');
  });
});

const changeRole = (
  actor: ReturnType<typeof party>,
  target: ReturnType<typeof party>,
  newRole: WorkspaceRole,
  ownerCount = 2,
) => decideRoleChange({ actor, target, newRole, ownerCount });

describe('decideRoleChange — the last owner invariant', () => {
  it('refuses the sole owner demoting themselves, which orphans by a different route', () => {
    const decision = changeRole(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 'admin', 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('last_owner');
  });

  it('refuses demoting the only owner', () => {
    const decision = changeRole(party(OWNER_A, 'owner'), party(OWNER_B, 'owner'), 'member', 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('last_owner');
  });

  it('tells the sole owner what to do about it', () => {
    const decision = changeRole(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 'admin', 1);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.message).toContain('Promote someone else to owner first');
  });

  it('lets the sole owner promote someone else to owner — the move that unblocks leaving', () => {
    expect(changeRole(party(OWNER_A, 'owner'), party(MEMBER_A, 'member'), 'owner', 1)).toEqual({
      permitted: true,
      selfChange: false,
      direction: 'promotion',
    });
  });

  it('lets an owner step down once a second owner exists', () => {
    expect(changeRole(party(OWNER_A, 'owner'), party(OWNER_A, 'owner'), 'admin', 2)).toEqual({
      permitted: true,
      selfChange: true,
      direction: 'demotion',
    });
  });
});

describe('decideRoleChange — only an owner may create an owner', () => {
  it.each(['admin', 'member'] as const)('refuses %s granting the owner role', (role) => {
    const decision = changeRole(party(ADMIN_A, role), party(MEMBER_B, 'member'), 'owner');

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('not_permitted');
    expect(decision.message).toContain('Only an owner can create another owner');
  });

  it('refuses an admin promoting themselves to owner, which would make the model decorative', () => {
    const decision = changeRole(party(ADMIN_A, 'admin'), party(ADMIN_A, 'admin'), 'owner');

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('not_permitted');
  });

  it('refuses a member promoting themselves to admin', () => {
    const decision = changeRole(party(MEMBER_A, 'member'), party(MEMBER_A, 'member'), 'admin');

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.message).toContain('cannot promote yourself');
  });

  it('permits an owner granting owner', () => {
    expect(changeRole(party(OWNER_A, 'owner'), party(MEMBER_A, 'member'), 'owner')).toEqual({
      permitted: true,
      selfChange: false,
      direction: 'promotion',
    });
  });
});

describe('decideRoleChange — who may set whose role', () => {
  it.each([
    { actor: 'owner', target: 'admin', to: 'member' },
    { actor: 'owner', target: 'member', to: 'admin' },
    { actor: 'admin', target: 'member', to: 'admin' },
  ] as const)('permits a $actor setting a $target to $to', ({ actor, target, to }) => {
    const decision = changeRole(party(OWNER_A, actor), party(MEMBER_B, target), to);

    expect(decision.permitted).toBe(true);
  });

  it.each([
    { actor: 'member', target: 'member', to: 'admin' },
    { actor: 'member', target: 'admin', to: 'member' },
    { actor: 'admin', target: 'admin', to: 'member' },
    { actor: 'admin', target: 'owner', to: 'member' },
  ] as const)('refuses a $actor setting a $target to $to', ({ actor, target, to }) => {
    const decision = changeRole(party(MEMBER_A, actor), party(ADMIN_B, target), to);

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.code).toBe('not_permitted');
  });

  it('lets anyone step down without asking, mirroring self-removal', () => {
    expect(changeRole(party(ADMIN_A, 'admin'), party(ADMIN_A, 'admin'), 'member')).toEqual({
      permitted: true,
      selfChange: true,
      direction: 'demotion',
    });
  });
});

describe('decideRoleChange — a no-op is refused rather than recorded', () => {
  it.each(['owner', 'admin', 'member'] as const)(
    'refuses setting %s to what it already is',
    (role) => {
      const decision = changeRole(party(OWNER_A, 'owner'), party(MEMBER_B, role), role);

      expect(decision.permitted).toBe(false);
      if (decision.permitted) return;
      expect(decision.code).toBe('role_unchanged');
    },
  );

  it('says nothing was recorded, because the audit log is what someone reads later', () => {
    const decision = changeRole(party(OWNER_A, 'owner'), party(MEMBER_B, 'member'), 'member');

    expect(decision.permitted).toBe(false);
    if (decision.permitted) return;
    expect(decision.message).toContain('no privilege change was recorded');
  });
});

describe('promotion then departure — the path this exists to enable', () => {
  it('a sole owner can promote a member to owner and then leave', () => {
    // Step 1: the sole owner cannot leave.
    const blocked = decideRemoval({
      remover: party(OWNER_A, 'owner'),
      target: party(OWNER_A, 'owner'),
      ownerCount: 1,
    });
    expect(blocked.permitted).toBe(false);
    if (blocked.permitted) return;
    expect(blocked.code).toBe('last_owner');

    // Step 2: they promote a member to owner.
    const promotion = changeRole(party(OWNER_A, 'owner'), party(MEMBER_A, 'member'), 'owner', 1);
    expect(promotion.permitted).toBe(true);

    // Step 3: with two owners, the original owner can now leave.
    const departure = decideRemoval({
      remover: party(OWNER_A, 'owner'),
      target: party(OWNER_A, 'owner'),
      ownerCount: 2,
    });
    expect(departure).toEqual({ permitted: true, selfRemoval: true });
  });

  it('the promoted owner can also remove the original, rather than only the reverse', () => {
    const decision = decideRemoval({
      remover: party(MEMBER_A, 'owner'),
      target: party(OWNER_A, 'owner'),
      ownerCount: 2,
    });

    expect(decision).toEqual({ permitted: true, selfRemoval: false });
  });
});
