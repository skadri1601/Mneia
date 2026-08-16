'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentAccount, tokenStore } from '../../server/current-account.js';
import { revokeWorkspaceToken, TokenError } from '../../server/tokens.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const REVOKE_FAILURES: ReadonlySet<string> = new Set(['token_not_found', 'not_permitted']);

export async function revokeTokenAction(formData: FormData): Promise<void> {
  let destination = '/tokens?notice=revoked';

  try {
    const account = await getCurrentAccount();
    await revokeWorkspaceToken({
      workspaceId: account.workspace.id,
      tokenId: textField(formData, 'tokenId'),
      actorId: account.actor.id,
      membership: account.membership,
      store: tokenStore,
    });
  } catch (error) {
    if (error instanceof TokenError && REVOKE_FAILURES.has(error.code)) {
      destination = `/tokens?error=${error.code}`;
    } else {
      throw error;
    }
  }

  revalidatePath('/tokens');
  redirect(destination);
}
