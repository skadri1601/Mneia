# Deploying `apps/web`

Host ruled by MNE-165 on 2026-08-02: **DigitalOcean droplet**, Cloudflare in front as DNS and proxy.
`apps/site` stays on Cloudflare. Nothing here applies to the marketing site.

## Which role the application connects as

**This is the part that is easy to get wrong and silent when you do.**

| Connection | Role | Why |
|---|---|---|
| `apps/web`, and the hosted API when it exists | **`mneia_app`** | `NOSUPERUSER NOBYPASSRLS`. Postgres row-level security applies to it, so `workspace_id` isolation is real. |
| `pnpm db:migrate` | `neondb_owner` | Creating and altering tables is owner work. Neon grants it `neon_superuser`, which carries `BYPASSRLS`. |
| Integration tests | `neondb_owner` | They create and drop their own schemas. |

`mneia_app` was provisioned against production Neon on 2026-08-02 (MNE-186). Reproduce it, on a new
Neon branch or a fresh project, with:

```
pnpm db:provision-app-role            # preview, executes nothing
pnpm db:provision-app-role --apply    # create the role and print the connection string
```

It reads the privileged `DATABASE_URL` from `.env`, creates the role with a generated password, grants
it DML on `public` plus default privileges for tables added later, and then **verifies its own work**:
it reports `rolsuper` and `rolbypassrls`, and fails if the role inherits a bypass through a group.
The connection string is printed once and written nowhere.

`PostgresStoreAdapter.withScope` and both `apps/web` stores call `assertConnectionEnforcesRls` before
they open a transaction. If `DATABASE_URL` names a role that bypasses RLS, they refuse to run and say
which role and how to fix it. **`MNEIA_ALLOW_RLS_BYPASS=1` exists for migrations, and for nothing
else.** Setting it on the application is how one workspace ends up reading another's rows.

Verify a connection string before you trust it:

```
psql "$DATABASE_URL" -c "SELECT current_user, current_setting('is_superuser'), rolbypassrls FROM pg_roles WHERE rolname = current_user"
```

Expect `mneia_app | off | f`. Anything else and RLS is inert.

## Environment

Names and purposes belong in this repo. **Values never do.** They live in `/etc/mneia/web.env` on the
droplet and in GitHub Actions secrets.

**Ownership and mode matter, and `600 root:root` does not work.** `docker compose` reads `env_file`
as the invoking user, not inside the container, so the `deploy` user must be able to read it. The
first deploy failed with `open /etc/mneia/web.env: permission denied` for exactly this reason:

```
/etc/mneia           750  root:deploy    deploy needs to traverse the directory, not only read the file
/etc/mneia/web.env   640  root:deploy    compose reads it as deploy; nobody else can
/etc/mneia/tls       700  root:root      Caddy runs as root inside its container and mounts this
/etc/mneia/tls/origin.key  600  root:root
```

**`NEXT_PUBLIC_*` variables cannot be set here.** Next inlines them at build time, so a value in this
file is read at runtime and has no effect — it looks configured and does nothing. Anything
`NEXT_PUBLIC_` has to be a Docker build arg *and* a CI secret. This cost us a live 404 on `/projects`:
`NEXT_PUBLIC_CLERK_SIGN_IN_URL` was in this file, was never in the bundle, and Clerk fell back to
rewriting a `notFound()` for signed-out visitors. Prefer deriving the value in code, as
`middleware.ts` now does, over adding another build arg.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon, as `mneia_app`. Use the **direct** endpoint, not `-pooler`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. Inlined at build time, so it is a build arg **and** a CI secret; the copy here is for parity only. |
| `CLERK_SECRET_KEY` | Clerk secret key. Runtime only. **Never a build arg** — build args are readable in image history. |
| `SENTRY_DSN` | Error reporting. Optional; absent means no reporting, not a crash. |
| `MNEIA_SUPER_ADMIN_SUBJECTS` | Comma-separated Clerk user IDs allowed into `/admin`. **Unset admits nobody**, which is safe but makes the waitlist queue unreachable. There is no way to grant this from inside the product — that is the point. |
| `RESEND_API_KEY` | Sends the access email on approval. Absent means approve is refused rather than approving someone we cannot reach. |
| `WAITLIST_FROM` | The `From` address on that email. **Use `Mneia <saad@mneia.dev>`, not `hello@`** — Cloudflare Email Routing forwards `saad@` and drops everything unrouted, so replies to `hello@` vanish. Same variable name `apps/site` and `waitlist:notify` already use. |
| `MNEIA_APP_ORIGIN` | Origin used to build the invitation's `/welcome` redirect. Defaults to `https://app.mneia.dev`. Deliberately **not** `NEXT_PUBLIC_` — see the warning above; a public-prefixed name would be inlined at build time and ignored here. |
| `MNEIA_SITE_ORIGIN` | Marketing origin used to build unsubscribe links in the access email. Defaults to `https://mneia.dev`. Same reasoning. |
| `MNEIA_INVITE_FROM` | The `From` address on a **workspace invitation** (MNE-252). Separate from `WAITLIST_FROM` on purpose: an invitation is transactional mail to an address a customer supplied, and it must never be sent from the waitlist identity or recorded in `waitlist_broadcast_send`. Unset means the invitation is still created and the join link still shown, but no email goes out and the inviter is told the send failed. |

## Billing (MNE-141/142/143) — wired, deliberately not live

The Stripe backend exists and is **switched off**, which is a state, not an omission.

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key. Runtime only, never a build arg. |
| `STRIPE_PRICE_ID` | The recurring price the subscription is built from. §14 sets it at **$24 per user per month**. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook`. Events failing verification are refused, not applied. |

**All three must be set or none of it runs.** `readStripeConfiguration` returns null unless all three
are present, `/api/stripe/webhook` answers `503 not_configured`, and no workspace changes plan. A
half-configured billing path is worse than none — it charges people or grants capacity on partial
information.

There is **no checkout page**. Nothing in `apps/web` lets a user start a subscription; billing state
changes only in response to a verified Stripe webhook. That is deliberate: `ROADMAP.md` §M1 says not
to ship a checkout page against §14's feature table until the open question of what a paying customer
gets before M4 is answered, and standing rule 7 keeps the individual tier free.

The webhook acts on `customer.subscription.created`, `.updated`, and `.deleted`. It finds the
workspace from `metadata.workspace_id`, falling back to `billing_customer_ref`, and declines rather
than guessing when neither identifies one. An unrecognised Stripe status is refused rather than mapped
by assumption, because guessing wrong either bills a cancelled workspace or gives a lapsed one free
capacity.

`pnpm funnel:report` reads the §18 kill criterion — individual-to-team conversion — from existing rows
and §17 events. It needs no new event names and works before billing is live; it simply reports that
nothing pays yet.

## Signup email verification (MNE-250)

**Clerk must require a verified email address before a signup completes.** In the Clerk dashboard:
*User & Authentication → Email, Phone, Username → Email address → Verify at sign-up*, set to required.

`MNE-173`'s daily inference ceiling is keyed on the **workspace**, so a fresh API token cannot reset
it. A fresh *account* could: a new Clerk subject means a new `bootstrapSoloAccount`, a new workspace,
and a clean ceiling. Email verification is the friction that makes cycling cost something.

**The code does not trust that dashboard setting.** `resolveCurrentAccount`
(`apps/web/src/server/current-account.ts`) refuses with `email_unverified` when the signed-in Clerk
user has no verified primary address, before any workspace is provisioned. Because both `/welcome`
and the device-approval page that mints a CLI token resolve the account through that one function,
neither is reachable without a verified address — so the invariant holds even if the dashboard toggle
is switched off later. `current-account.test.ts` covers it.

Keep both: the dashboard setting stops the signup, and the guard stops the provisioning.

GitHub Actions secrets, for `deploy-web.yml`:

| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | Droplet IP or hostname |
| `DEPLOY_USER` | The deploy user — **not** root |
| `DEPLOY_SSH_KEY` | Private key for that user |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>`. Pinning this is what stops the runner trusting a host it has never met. |
| `DEPLOY_PUBLIC_HOST` | `app.mneia.dev`, for the post-deploy health check |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Needed at build time in CI |

There is deliberately **no long-lived registry PAT**. The `ship` job requests `packages: read` and
pipes its own `GITHUB_TOKEN` into `docker login` on the droplet — a token that expires with the job,
rather than a personal access token sitting in a secret store until someone remembers to rotate it.

## Droplet

**Region `nyc3`.** The Neon project is `us-east-2` (AWS Ohio); `nyc3` is the closest DigitalOcean
region to it. Standing rule 4 is a 300ms p95 on `mneia_rehydrate`, and a cross-continent hop spends
that budget before any query runs. Do not put the droplet in `fra1` or `sgp1` while the database is
in Ohio.

**Size: `s-2vcpu-2gb`.** Next.js in production is memory-bound more than CPU-bound, and 1GB leaves no
room for the build cache plus Caddy. Resize later; it is a reboot, not a rebuild.

Image: Ubuntu 24.04 LTS.

### First-time setup, once per droplet

```
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
install -d -m 755 /opt/mneia
chown deploy:deploy /opt/mneia
install -d -m 700 /etc/mneia
```

Put the deploy user's public key in `/home/deploy/.ssh/authorized_keys`, write `/etc/mneia/web.env`,
then disable password and root SSH login — `/etc/ssh/sshd_config.d/99-mneia.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
```

**Do this last.** Reloading sshd ends root access immediately, and `deploy` has no `sudo`.

**`deploy` is in the `docker` group, and that is already root-equivalent** — anyone who can run
`docker` can bind-mount `/` into a privileged container. So `DEPLOY_SSH_KEY` in GitHub Actions
effectively holds root on this box. That is inherent to shipping containers over SSH, not something
this setup added, but do not mistake "the deploy user has no sudo" for a boundary. It is also the
mechanism for root-owned edits after hardening:

```
docker run --rm -v /etc/mneia:/m -i alpine sh -c 'umask 077; cat > /m/web.env'
```

Firewall: `22` from anywhere, and `80`/`443` **only from Cloudflare's published v4 ranges**:

```
curl -s https://www.cloudflare.com/ips-v4 -o /tmp/cf-v4
ufw default deny incoming && ufw default allow outgoing && ufw allow 22/tcp
while read -r cidr; do
  ufw allow from "$cidr" to any port 80 proto tcp
  ufw allow from "$cidr" to any port 443 proto tcp
done < /tmp/cf-v4
ufw --force enable
```

Verify it took: `curl -m 8 http://<droplet-ip>/api/health` must time out. If it answers, the origin
is reachable directly and Cloudflare is decorative.

**TLS does not stop at Cloudflare.** Caddy serves 443 with a Cloudflare Origin CA certificate and
`:80` only redirects. The zone is **Full (strict)**, which validates that certificate rather than
accepting anything the origin presents. Generate the CSR **on the droplet** so the private key is
created there and never travels:

```
openssl req -new -newkey rsa:2048 -nodes \
  -keyout /etc/mneia/tls/origin.key -out /tmp/origin.csr -subj "/CN=app.mneia.dev"
```

Then issue against it via the Cloudflare API and write the result to `/etc/mneia/tls/origin.pem`.
The certificate runs to 2041; the zone-level SSL mode is what enforces validation.

An earlier version of this runbook said TLS terminated at Cloudflare and Caddy served plain HTTP.
That was wrong for an app carrying a session cookie: the Cloudflare-to-origin leg crosses the public
internet, and the browser padlock describes the visitor's leg only.

### DNS

`app.mneia.dev` → droplet IP, **proxied** (orange cloud), SSL mode Full. The marketing site keeps
`mneia.dev`.

## Deploying

`\.github/workflows/deploy-web.yml`, on push to `main` touching `apps/web`, `packages/core`, `deploy/`,
or the Dockerfile — and on `workflow_dispatch`. It builds the image in CI, pushes to GHCR, then pulls
and restarts over SSH, and finally polls `/api/health` until it answers.

**Deploys never run by hand over SSH.** That is what keeps an audit trail, and what keeps
`CLAUDE.md`'s *ask before production* boundary meaningful. If the workflow is broken, fix the
workflow.

Rollback is the same workflow against an earlier commit, or on the box:

```
MNEIA_WEB_IMAGE=ghcr.io/<owner>/<repo>/web:<previous-sha> docker compose up -d
```

## Migrations

Nothing migrates production automatically, and that is deliberate. Applying is a considered
`pnpm db:migrate` against the production `DATABASE_URL` — **the privileged one**, not `mneia_app` —
and `CLAUDE.md` requires asking first, every time.
