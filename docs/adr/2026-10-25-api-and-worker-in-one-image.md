# The api and the worker form a single server, whose role is chosen at startup

nudge is self-hosted, most often on a single machine and for a single team. Two applications (api, worker) meant two images to publish, two services to declare and two versions that could drift apart, even though they share the database schema and the types. The worker becomes a library (`packages/worker`) that the server (`apps/api`) starts according to `NUDGE_ROLES`: `api,worker` by default, in a single process, or `api` and `worker` separately, with the same `ghcr.io/garage-sh/nudge` image.

## Considered Options

- **Two applications, two images** (before): separation is guaranteed, but each Instance carries one more service and the api and the worker can run at different versions.
- **Two applications, one image**: a single version, but still two processes to declare, even for a small Instance.
- **Full merge into a single Nest module**: the simplest, but we lose the ability to scale the worker without the api, and a Triage spike would always slow down collection.

## Consequences

By default, ingestion and Triage share the same event loop: a Triage spike can slow down collection, and a fatal worker error also stops the api. A busy Instance splits the roles (`docker-compose.worker.yml`). The api and the worker remain two distinct Nest contexts, with no shared provider apart from Capture storage. The process handles shutdown itself: it closes the api, then the worker, before exiting.
