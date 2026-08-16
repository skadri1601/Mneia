import Link from 'next/link';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { getCurrentAccount, tokenStore } from '../../server/current-account.js';
import { type ApiTokenSummary, isExpired, listWorkspaceTokens } from '../../server/tokens.js';
import { revokeTokenAction } from './actions.js';
import styles from './tokens.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TokensPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const ERRORS: Readonly<Record<string, string>> = {
  token_not_found: 'That token was already revoked, or it never existed.',
  not_permitted:
    'You can revoke your own tokens. Revoking someone else’s needs a workspace lead — ask one of yours.',
};

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

const describeLastUsed = (token: ApiTokenSummary): string =>
  token.lastUsedAt === null ? 'never used' : `last used ${formatDate(token.lastUsedAt)}`;

const describeExpiry = (token: ApiTokenSummary): string => {
  if (token.expiresAt === null) return 'no expiry';
  return isExpired(token)
    ? `expired ${formatDate(token.expiresAt)}`
    : `expires ${formatDate(token.expiresAt)}`;
};

export default async function TokensPage({ searchParams }: TokensPageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);
  const tokens = await listWorkspaceTokens({
    workspaceId: account.workspace.id,
    store: tokenStore,
  });

  const error = ERRORS[first(query.error) ?? ''];
  const notice = first(query.notice);
  const isLead = account.membership.role === 'lead';

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <WorkspaceSwitcher current={account.workspace.id} workspaces={account.workspaces} />
        <h1>API tokens</h1>
        <p>
          Every token here was minted by <code>mneia login</code> approving a device code. Revoking
          one takes effect on its next request; the machine holding it has to run{' '}
          <code>mneia login</code> again. The token itself is stored only as a hash and cannot be
          shown again.
        </p>
      </header>

      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice === 'revoked' ? (
        <p className={styles.notice} role="status">
          Token revoked.
        </p>
      ) : null}

      <section className={styles.card}>
        <h2>Live tokens</h2>
        {tokens.length === 0 ? (
          <p>
            No live tokens. Run <code>mneia login</code> on a machine and approve the code to mint
            one.
          </p>
        ) : (
          <ul className={styles.tokenList}>
            {tokens.map((token) => {
              const mine = token.actorId === account.actor.id;
              return (
                <li key={token.id} className={styles.token}>
                  <div>
                    <p className={styles.tokenLabel}>
                      {token.label.length === 0 ? 'Unlabelled token' : token.label}
                      {isExpired(token) ? <span className={styles.stale}> · expired</span> : null}
                    </p>
                    <p className={styles.tokenMeta}>
                      {mine ? 'You' : token.actorDisplayName} · created{' '}
                      {formatDate(token.createdAt)} · {describeLastUsed(token)} ·{' '}
                      {describeExpiry(token)}
                    </p>
                    <p className={styles.tokenMeta}>
                      <span className={styles.scopes}>{token.scopes.join(' ')}</span>
                    </p>
                  </div>
                  {mine || isLead ? (
                    <form action={revokeTokenAction}>
                      <input type="hidden" name="tokenId" value={token.id} />
                      <button type="submit" className={styles.revoke}>
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Link className={styles.backLink} href="/projects">
        Back to projects
      </Link>
    </main>
  );
}
