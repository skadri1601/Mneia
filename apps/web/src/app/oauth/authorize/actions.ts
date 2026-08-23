'use server';

import { createHash, randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getCurrentAccount } from '../../../server/current-account.js';
import {
  AUTHORIZATION_CODE_LIFETIME_SECONDS,
  MCP_SCOPE,
  oauthStore,
} from '../../../server/oauth-runtime.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

/**
 * The approval step of the authorization code flow.
 *
 * Everything security-relevant is re-derived here rather than trusted from the form: the client is
 * looked up again and the redirect URI is checked against its registration a second time. The page
 * already validated both, but a form post is a separate request and a rendered page is not a
 * security boundary — without this, a crafted POST could redirect a code anywhere.
 *
 * The actor and workspace come from the Clerk session, never from the form, so a code can only ever
 * be issued for the workspace the person approving it actually belongs to.
 */
export async function decideAuthorizationAction(formData: FormData): Promise<void> {
  const clientId = textField(formData, 'clientId');
  const redirectUri = textField(formData, 'redirectUri');
  const state = textField(formData, 'state');
  const codeChallenge = textField(formData, 'codeChallenge');
  const resource = textField(formData, 'resource');
  const approved = textField(formData, 'decision') === 'approve';

  const client = await oauthStore.findClient(clientId);
  if (client === null || !client.redirectUris.includes(redirectUri)) {
    // Never redirect to a URI the client did not register — that is how an authorization code gets
    // handed to somebody else. With nowhere trustworthy to send the person, the error stays here.
    redirect('/oauth/authorize?error=invalid_client');
  }

  const target = new URL(redirectUri);
  if (state.length > 0) {
    target.searchParams.set('state', state);
  }

  if (!approved) {
    target.searchParams.set('error', 'access_denied');
    target.searchParams.set('error_description', 'The person signed in declined this request.');
    redirect(target.toString());
  }

  const account = await getCurrentAccount();

  // The code is returned to the client in a URL; only its hash is stored, so a leaked database row
  // cannot be replayed as a code. Same shape as the device grant's device_code_hash.
  const code = `${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;

  await oauthStore.issueCode({
    clientId,
    workspaceId: account.workspace.id,
    actorId: account.actor.id,
    redirectUri,
    codeHash: createHash('sha256').update(code).digest('hex'),
    codeChallenge,
    resource: resource.length === 0 ? null : resource,
    scope: MCP_SCOPE,
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_LIFETIME_SECONDS * 1000),
  });

  target.searchParams.set('code', code);
  redirect(target.toString());
}
