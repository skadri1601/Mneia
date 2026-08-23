import { getCurrentAccount } from '../../../server/current-account.js';
import { oauthStore } from '../../../server/oauth-runtime.js';
import styles from '../../device/device.module.css';
import { decideAuthorizationAction } from './actions.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface AuthorizePageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

/**
 * The consent screen of the authorization code flow.
 *
 * It is deliberately not in middleware's isPublicRoute: Clerk must sign the person in before they
 * can approve anything, and their session is the only source of the workspace a code is issued for.
 *
 * Errors that arrive before the client is validated are shown here rather than redirected. Sending
 * an error to an unverified redirect_uri is how an authorization code ends up somewhere it should
 * not be, so nothing leaves this page until the URI is known to belong to the registered client.
 */
export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);

  const clientId = first(query.client_id) ?? '';
  const redirectUri = first(query.redirect_uri) ?? '';
  const responseType = first(query.response_type) ?? '';
  const codeChallenge = first(query.code_challenge) ?? '';
  const codeChallengeMethod = first(query.code_challenge_method) ?? '';
  const state = first(query.state) ?? '';
  const resource = first(query.resource) ?? '';

  const client = clientId.length === 0 ? null : await oauthStore.findClient(clientId);

  const refusal =
    client === null
      ? 'That application is not registered with Mneia, so there is nothing to approve.'
      : !client.redirectUris.includes(redirectUri)
        ? 'That application asked to be sent somewhere it has not registered. Nothing was approved.'
        : responseType !== 'code'
          ? `This server issues authorization codes only. The application asked for response_type "${responseType || 'nothing'}".`
          : // PKCE is mandatory in OAuth 2.1, and S256 is the only method the code table accepts.
            codeChallenge.length === 0 || codeChallengeMethod !== 'S256'
            ? 'That application did not present a valid PKCE challenge, which this server requires. It needs code_challenge with code_challenge_method=S256.'
            : null;

  if (refusal !== null) {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <p>Connect an application</p>
          <h1>This request cannot be approved</h1>
          <p>{refusal}</p>
        </header>
      </main>
    );
  }

  const clientName = client?.clientName ?? 'An application';

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>Connect an application</p>
        <h1>Allow {clientName} to use your project memory?</h1>
        <p>
          You are signed in as {account.actor.displayName} in {account.workspace.displayName}.
          Approving lets <strong>{clientName}</strong> read and write context items, checkpoints and
          handoffs in <strong>this</strong> workspace, as you.
        </p>
        <p>
          It cannot reach any other workspace, and you can revoke it at any time from your tokens
          page.
        </p>
      </header>

      <form action={decideAuthorizationAction} className={styles.form}>
        <input name="clientId" type="hidden" value={clientId} />
        <input name="redirectUri" type="hidden" value={redirectUri} />
        <input name="state" type="hidden" value={state} />
        <input name="codeChallenge" type="hidden" value={codeChallenge} />
        <input name="resource" type="hidden" value={resource} />

        <button name="decision" type="submit" value="approve">
          Allow {clientName}
        </button>
        <button name="decision" type="submit" value="deny">
          Deny
        </button>
      </form>
    </main>
  );
}
