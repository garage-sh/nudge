# Development

You need Node 26 (`.nvmrc`) and Docker. Yarn 4 is shipped in the repository (`.yarn/releases`). To contribute, read [`CONTRIBUTING.md`](../CONTRIBUTING.md) as well.

## Running locally

```bash
yarn install
cat > .env <<EOF
DATABASE_URL=postgres://nudge:nudge@localhost:5432/nudge
REDIS_URL=redis://localhost:6379
NUDGE_ENCRYPTION_KEY=$(openssl rand -base64 32)
NUDGE_COOKIE_SECURE=false
NUDGE_DASHBOARD_URL=http://localhost:5173
NUDGE_CAPTURES_DIR=$PWD/.data/captures
EOF
yarn dev:infra             # Postgres and Redis (docker-compose.dev.yml)
yarn db:migrate
yarn dev                   # api and worker on :3000, dashboard on :5173 (relays /api to :3000)
```

The api and the `db:*` scripts read the root `.env`; a variable already exported in the shell takes precedence. The other variables are described in [`.env.example`](../.env.example) and [Configuration](configuration.md).

`yarn dev` runs `dev:infra` again, builds the packages the apps depend on, then starts the api (with the worker) and the dashboard in watch mode. A single app: `yarn workspace @nudge/api dev`. The worker is the `packages/worker` library, which the api starts according to `NUDGE_ROLES`.

`yarn dev:reset` starts over from an empty local Instance: it drops the Postgres volume and the Redis queues, deletes the Captures in `.data/captures`, restarts the infrastructure and applies the migrations.

## Building the images

To build and run the images from source rather than pulling them from ghcr.io:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Checking a change

- `yarn check-types` checks the types;
- `yarn test` runs the tests (the pipeline tests start Postgres and Redis with testcontainers);
- `yarn workspace @nudge/widget test:e2e` runs the Widget's browser tests (Playwright);
- `yarn lint` runs the linter.
