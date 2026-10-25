# syntax=docker/dockerfile:1
#
# The two nudge images, built from the same build stage:
#
#   docker build --target server    -t nudge .            # the api and the worker (NUDGE_ROLES)
#   docker build --target dashboard -t nudge-dashboard .
#
# Published to ghcr.io/garage-sh/nudge and ghcr.io/garage-sh/nudge-dashboard by CI
# (.github/workflows/images.yml). To build them locally:
# `docker compose -f docker-compose.yml -f docker-compose.build.yml build`.

# The base images are pinned by digest: they do not change under the same nudge tag.
# Dependabot proposes the new digest when Alpine or Node are patched.

# --- Build: full dependencies, then builds of all the apps and the Widget ----------------
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
ENV YARN_ENABLE_TELEMETRY=0 TURBO_TELEMETRY_DISABLED=1

# The manifests alone first: the install stays cached as long as they do not change.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
# Recent Node images no longer ship Yarn: the repository's (`yarnPath`) is enough.
RUN printf '#!/bin/sh\nexec node /app/.yarn/releases/yarn-*.cjs "$@"\n' > /usr/local/bin/yarn \
 && chmod +x /usr/local/bin/yarn
COPY apps/api/package.json apps/api/
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/core/package.json packages/core/
COPY packages/database/package.json packages/database/
COPY packages/destinations/package.json packages/destinations/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/judge/package.json packages/judge/
COPY packages/sdk/package.json packages/sdk/
COPY packages/shared/package.json packages/shared/
COPY packages/storage/package.json packages/storage/
COPY packages/tsup-config/package.json packages/tsup-config/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/widget/package.json packages/widget/
COPY packages/worker/package.json packages/worker/
COPY tests/pipeline/package.json tests/pipeline/
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

COPY . .
RUN yarn turbo run build \
      --filter=@nudge/api --filter=@nudge/dashboard --filter=@nudge/widget

# What the server (api and worker) needs at runtime: production dependencies, package
# builds and SQL migrations. None of their sources nor the build tools.
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus @nudge/api --production \
 && mkdir -p /prod \
 && cp -a package.json node_modules /prod/ \
 && for ws in apps/api packages/core packages/database packages/destinations \
              packages/judge packages/shared packages/storage packages/worker; do \
      mkdir -p "/prod/$ws" && cp -a "$ws/package.json" "$ws/dist" "/prod/$ws/"; \
    done \
 && cp -a packages/database/drizzle /prod/packages/database/

# --- server: the api and the worker, in one or more processes ------------------------
# NUDGE_ROLES picks the role: `api`, `worker`, or both (the default). The compose
# `migrate` service runs `node apps/api/dist/migrate.js` in it.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS server
ARG VERSION=dev
LABEL org.opencontainers.image.title="nudge" \
      org.opencontainers.image.description="Collects, triages and dispatches user feedback: api and worker." \
      org.opencontainers.image.source="https://github.com/garage-sh/nudge" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production
WORKDIR /app
# The Captures volume (disk storage): a new named volume inherits this owner, and the
# server runs as `node`.
RUN mkdir -p /var/lib/nudge/captures && chown node:node /var/lib/nudge/captures
COPY --from=build /prod /app
USER node
EXPOSE 3000
# A process without the api role does not listen: it is healthy as long as it runs.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD case ",${NUDGE_ROLES:-api,worker}," in \
        *,api,*) wget -q -O /dev/null "http://127.0.0.1:${NUDGE_API_PORT:-3000}/api/setup" ;; \
        *) true ;; \
      esac || exit 1
CMD ["node", "apps/api/dist/main.js"]

# --- dashboard: static files, Widget and proxy to the api (same origin) --------------
FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS dashboard
ARG VERSION=dev
LABEL org.opencontainers.image.title="nudge-dashboard" \
      org.opencontainers.image.description="nudge dashboard and Widget, served by nginx with a proxy to the api." \
      org.opencontainers.image.source="https://github.com/garage-sh/nudge" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
# Address of the api as seen from this container, and the DNS server that resolves it
# (Docker's): re-resolved every 10 s, the api can restart or have several replicas.
ENV NUDGE_API_UPSTREAM=http://nudge:3000 NUDGE_DNS_RESOLVER=127.0.0.11
COPY apps/dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY --from=build /app/packages/widget/dist/nudge-widget.js /usr/share/nginx/html/widget/nudge-widget.js
EXPOSE 8080
