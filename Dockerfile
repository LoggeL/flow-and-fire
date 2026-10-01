# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.10.0
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm assets
ARG SOURCE_REVISION
# A source digest keeps standalone Docker builds versioned without copying .git.
RUN SOURCE_DIGEST="$(find apps packages tools content -type f ! -path '*/node_modules/*' ! -path '*/dist/*' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)" \
    && FAF_BUILD_HASH="${SOURCE_REVISION:-$SOURCE_DIGEST}" pnpm --filter @faf/game build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /workspace/apps/game/dist ./payload
COPY --chown=node:node apps/game/scripts/serve.mjs ./serve.mjs
COPY --chown=node:node deploy/release-archive.mjs deploy/start.mjs ./
# Docker seeds a new named volume with this directory's non-root ownership.
RUN mkdir /app/releases && chown node:node /app/releases
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/build.json').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "start.mjs"]
