# syntax=docker/dockerfile:1
#
# Les trois images de nudge, construites depuis une même étape de build :
#
#   docker build --target api       -t nudge-api .
#   docker build --target worker    -t nudge-worker .
#   docker build --target dashboard -t nudge-dashboard .
#
# `docker compose build` (docker-compose.yml) les construit toutes les trois.

ARG NODE_IMAGE=node:26-alpine
ARG NGINX_IMAGE=nginx:1.29-alpine

# --- Build : dépendances complètes, puis builds de toutes les apps et du Widget ----------
FROM ${NODE_IMAGE} AS build
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
COPY apps/worker/package.json apps/worker/
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
COPY tests/pipeline/package.json tests/pipeline/
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

COPY . .
RUN yarn turbo run build \
      --filter=@nudge/api --filter=@nudge/worker --filter=@nudge/dashboard --filter=@nudge/widget

# Ce dont l'api et le worker ont besoin à l'exécution : dépendances de production,
# builds des packages et migrations SQL. Rien de leurs sources ni des outils de build.
RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus @nudge/api @nudge/worker --production \
 && mkdir -p /prod \
 && cp -a package.json node_modules /prod/ \
 && for ws in apps/api apps/worker packages/core packages/database packages/destinations \
              packages/judge packages/shared packages/stockage; do \
      mkdir -p "/prod/$ws" && cp -a "$ws/package.json" "$ws/dist" "/prod/$ws/"; \
    done \
 && cp -a packages/database/drizzle /prod/packages/database/

# --- Socle de l'api et du worker : les deux images partagent ces couches ---------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Le volume des Captures (stockage disque) : un volume nommé neuf hérite de ce
# propriétaire, et l'api comme le worker tournent en `node`.
RUN mkdir -p /var/lib/nudge/captures && chown node:node /var/lib/nudge/captures
COPY --from=build /prod /app
USER node

# --- worker : Triage et Dispatch (aucun port) -----------------------------------------
FROM runtime AS worker
CMD ["node", "apps/worker/dist/main.js"]

# --- api : ingestion publique et API du dashboard -------------------------------------
# `node apps/api/dist/migrate.js` applique les migrations (service `migrate` du compose).
FROM runtime AS api
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${NUDGE_API_PORT:-3000}/api/setup" || exit 1
CMD ["node", "apps/api/dist/main.js"]

# --- dashboard : fichiers statiques, Widget et proxy vers l'api (même origine) --------
FROM ${NGINX_IMAGE} AS dashboard
# Adresse de l'api vue depuis ce conteneur, et serveur DNS qui la résout (celui de
# Docker) : relu toutes les 10 s, l'api peut redémarrer ou avoir plusieurs répliques.
ENV NUDGE_API_UPSTREAM=http://api:3000 NUDGE_DNS_RESOLVER=127.0.0.11
COPY apps/dashboard/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
COPY --from=build /app/packages/widget/dist/nudge-widget.js /usr/share/nginx/html/widget/nudge-widget.js
EXPOSE 8080
