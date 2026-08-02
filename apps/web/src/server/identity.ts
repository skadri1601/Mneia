import 'server-only';

import type { Actor } from '@mneia/core';

export type IdentityErrorCode = 'unauthenticated' | 'account_not_found';

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode) {
    super(code);
    this.name = 'IdentityError';
    this.code = code;
  }
}

export interface ActorLookup {
  readonly subject: string;
  readonly workspaceId: string;
}

export interface ResolveActorInput {
  readonly subject: string | null;
  readonly workspaceId: string;
  readonly findActor: (lookup: ActorLookup) => Promise<Actor | null>;
}

export const resolveActor = async ({
  subject,
  workspaceId,
  findActor,
}: ResolveActorInput): Promise<Actor> => {
  if (subject === null) {
    throw new IdentityError('unauthenticated');
  }

  const actor = await findActor({ subject, workspaceId });
  if (
    actor === null ||
    actor.kind !== 'human' ||
    actor.workspaceId !== workspaceId ||
    actor.externalRef !== subject
  ) {
    throw new IdentityError('account_not_found');
  }

  return actor;
};
