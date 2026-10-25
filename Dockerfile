# syntax=docker/dockerfile:1
#
# Les deux images de nudge, construites depuis une même étape de build :
#
#   docker build --target server    -t nudge .            # l'api et le worker (NUDGE_ROLES)
#   docker build --target dashboard -t nudge-dashboard .
#
# Publiées sur ghcr.io/garage-sh/nudge et ghcr.io/garage-sh/nudge-dashboard par la CI
# (.github/workflows/images.yml). Pour les construire en local :
# `docker compose -f docker-compose.yml -f docker-compose.build.yml build`.

# Les images de base sont épinglées par digest : elles ne changent pas sous un même tag
# de nudge. Dependabot propose le nouveau digest quand Alpine ou Node sont corrigés.

# --- Build : dépendances complètes, puis builds de toutes les apps et du Widget ----------
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS build
WORKDIR /app
ENV YARN_ENABLE_TELEMETRY=0 TURBO_TELEMETRY_DISABLED=1

# Les manifestes seuls d'abord : l'installation reste en cache tant qu'ils ne changent pas.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
# Les images Node récentes n'embarquent plus Yarn : celui du dépôt (`yarnPath`) suffit.
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
COPY packages/stockage/package.json packages/stockage/
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

# Ce dont le serveur (api et worker) a besoin à l'exécution : dépendances de production,
# builds des packages et migrations SQL. Rien de leurs sources ni des outils de build.
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus @nudge/api --production \
 && mkdir -p /prod \
 && cp -a package.json node_modules /prod/ \
 && for ws in apps/api packages/core packages/database packages/destinations \
              packages/judge packages/shared packages/stockage packages/worker; do \
      mkdir -p "/prod/$ws" && cp -a "$ws/package.json" "$ws/dist" "/prod/$ws/"; \
    done \
 && cp -a packages/database/drizzle /prod/packages/database/

# --- server : l'api et le worker, dans un ou plusieurs processus ----------------------
# NUDGE_ROLES choisit le rôle : `api`, `worker`, ou les deux (par défaut). Le
# service `migrate` du compose y lance `node apps/api/dist/migrate.js`.
FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS server
ARG VERSION=dev
LABEL org.opencontainers.image.title="nudge" \
      org.opencontainers.image.description="Collecte, trie et dispatche les retours utilisateurs : api et worker." \
      org.opencontainers.image.source="https://github.com/garage-sh/nudge" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production
WORKDIR /app
# Le volume des Captures (stockage disque) : un volume nommé neuf hérite de ce
# propriétaire, et le serveur tourne en `node`.
RUN mkdir -p /var/lib/nudge/captures && chown node:node /var/lib/nudge/captures
COPY --from=build /prod /app
USER node
EXPOSE 3000
# Un processus sans le rôle api n'écoute pas : il est sain tant qu'il tourne.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD case ",${NUDGE_ROLES:-api,worker}," in \
        *,api,*) wget -q -O /dev/null "http://127.0.0.1:${NUDGE_API_PORT:-3000}/api/setup" ;; \
        *) true ;; \
      esac || exit 1
CMD ["node", "apps/api/dist/main.js"]

# --- dashboard : fichiers statiques, Widget et proxy vers l'api (même origine) --------
FROM nginx:1.29-alpine@sha256:5616878291a2eed594aee8db4dade5878cf7edcb475e59193904b198d9b830de AS dashboard
ARG VERSION=dev
LABEL org.opencontainers.image.title="nudge-dashboard" \
      org.opencontainers.image.description="Dashboard et Widget de nudge, servis par nginx avec un proxy vers l'api." \
      org.opencontainers.image.source="https://github.com/garage-sh/nudge" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}"
# Adresse de l'api vue depuis ce conteneur, et serveur DNS qui la résout (celui de
# Docker) : relu toutes les 10 s, l'api peut redémarrer ou avoir plusieurs répliques.
ENV NUDGE_API_UPSTREAM=http://nudge:3000 NUDGE_DNS_RESOLVER=127.0.0.11
COPY apps/dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY --from=build /app/packages/widget/dist/nudge-widget.js /usr/share/nginx/html/widget/nudge-widget.js
EXPOSE 8080
