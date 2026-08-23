FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY apps/web/package.json apps/web/
COPY apps/site/package.json apps/site/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
RUN pnpm --filter @mneia/core build
# apps/web imports the MCP tool registry to serve /api/mcp, so mcp-server must be built before it:
# the dependency resolves to packages/mcp-server/dist, which does not exist in a clean checkout.
# CI does not catch this — ci.yml runs `pnpm -r --if-present build`, which builds every member, so a
# missing filter here goes green there and fails only in the image build.
RUN pnpm --filter @mneia/mcp-server build
RUN pnpm --filter @mneia/web build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /repo

RUN groupadd --system --gid 1001 mneia && useradd --system --uid 1001 --gid mneia mneia

COPY --from=build --chown=mneia:mneia /repo/apps/web/.next/standalone ./
COPY --from=build --chown=mneia:mneia /repo/apps/web/.next/static ./apps/web/.next/static

USER mneia
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
