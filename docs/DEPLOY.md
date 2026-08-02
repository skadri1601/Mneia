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
droplet, mode `600`, owned by root, and in GitHub Actions secrets.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon, as `mneia_app`. Use the **direct** endpoint, not `-pooler`. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key. Baked at build time — it is a build arg as well as a runtime variable. |
| `CLERK_SECRET_KEY` | Clerk secret key. Runtime only. Never a build arg. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `/sign-up` |
| `SENTRY_DSN` | Error reporting. Optional; absent means no reporting, not a crash. |

GitHub Actions secrets, for `deploy-web.yml`:

| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | Droplet IP or hostname |
| `DEPLOY_USER` | The deploy user — **not** root |
| `DEPLOY_SSH_KEY` | Private key for that user |
| `DEPLOY_KNOWN_HOSTS` | Output of `ssh-keyscan <host>`. Pinning this is what stops the runner trusting a host it has never met. |
| `DEPLOY_PUBLIC_HOST` | `app.mneia.dev`, for the post-deploy health check |
| `GHCR_READ_TOKEN` | A PAT with `read:packages`, so the droplet can pull the image |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Needed at build time in CI |

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
then disable password and root SSH login in `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

Firewall: allow `22` and `80` only. **TLS terminates at Cloudflare**, so the droplet never serves 443
directly and Caddy runs with `auto_https off`. Restrict port 80 to Cloudflare's published ranges once
the DNS record is proxied, or the origin is reachable directly and Cloudflare becomes decorative.

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
