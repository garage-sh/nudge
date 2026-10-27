# Self-hosting nudge

How to run, expose, update, back up and scale a nudge Instance. The [Quick start](../README.md#quick-start) gets an Instance running; this page covers everything after that. Variables are described in [Configuration](configuration.md).

- [What runs](#what-runs)
- [First Member and setup token](#first-member-and-setup-token)
- [What the published port serves](#what-the-published-port-serves)
- [In production: HTTPS](#in-production-https)
- [Updating and pinning a version](#updating-and-pinning-a-version)
- [Verifying an image](#verifying-an-image)
- [Backing up](#backing-up)
- [Scaling](#scaling)

## What runs

An Instance is made of four containers: `nudge` (the api and the worker), `dashboard`, Postgres and Redis. A fifth container, `migrate`, applies the migrations then stops. The images are published to `ghcr.io/garage-sh/nudge` and `ghcr.io/garage-sh/nudge-dashboard`, for amd64.

## First Member and setup token

The first screen of the dashboard creates the first Member. It asks for the setup token, which only someone with access to the server knows: the `nudge` container prints it at startup while no Member exists.

```bash
docker compose logs nudge | grep 'setup token'
```

The token is derived from `NUDGE_ENCRYPTION_KEY`, so every api replica prints the same one; set `NUDGE_SETUP_TOKEN` (16 characters or more) to choose it yourself. Once the first Member exists, the setup closes for good.

The next Members are invited from the dashboard, with an invitation link. Any Member can remove another one from the **Members** screen, where each Member also changes their password and signs out their other sessions.

## What the published port serves

Only the `dashboard` container publishes a port (`NUDGE_PORT`, 8080 by default). It serves everything on the same origin:

| Path                      | Content                                                   |
| ------------------------- | --------------------------------------------------------- |
| `/`                       | the Members' dashboard                                    |
| `/api/…`                  | the dashboard API (cookie session), relayed to `nudge`    |
| `/v1/feedbacks`           | the public ingestion (Widget and SDK), relayed to `nudge` |
| `/widget/nudge-widget.js` | the Widget for the script tag                             |

Because everything is served on the same origin, the session cookie stays first-party, without CORS.

## In production: HTTPS

Put a TLS reverse proxy (Caddy, Traefik, nginx…) in front of the published port, then set:

- `NUDGE_DASHBOARD_URL=https://nudge.example.com` so that Deliveries and alerts carry a link to the Feedback;
- `NUDGE_TRUST_PROXY=2`, that is your proxy plus the dashboard's. The api reads the client IP from `X-Forwarded-For`, which the Widget rate limit and the sign-in brute-force protection rely on.

The published port listens on `127.0.0.1` only (`NUDGE_BIND`): a proxy on the same host reaches it, the network does not. A proxy running as a container can also join the compose network and target `dashboard:8080`; it counts as one hop all the same. Both values of `NUDGE_TRUST_PROXY` are wrong in one direction:

- **too high** (`2` while clients can reach the port without going through your proxy): a client sends its own `X-Forwarded-For` and chooses its IP, so it is never throttled. If your proxy runs on another machine and you set `NUDGE_BIND=0.0.0.0`, firewall the port so that only the proxy reaches it; Docker publishes ports past `ufw` and `firewalld` rules;
- **too low** (`1`, the default, behind a proxy): every client shares the proxy's IP. Ten sign-in attempts per minute from anyone then lock every Member out of sign-in, and all the Widgets share a single 20 Feedbacks per minute budget.

The session cookie is `Secure`, so HTTPS is required. Browsers make an exception for `http://localhost`. To try the Instance over HTTP from another machine, `NUDGE_BIND=0.0.0.0` and `NUDGE_COOKIE_SECURE=false` lift these protections (keep `NUDGE_TRUST_PROXY=1`), but never do it on an exposed Instance.

Before opening the Instance to real Authors, read [Operating an Instance](../SECURITY.md#operating-an-instance): Triage routing, the per-Project Widget budget and invitation links in logs.

## Updating and pinning a version

**Updating**: `docker compose pull && docker compose up -d`. The `migrate` service applies the new migrations before `nudge` restarts. Read the [release notes](https://github.com/garage-sh/nudge/releases) before changing minor version. There are no down migrations: going back to a previous version means restoring the Postgres backup taken before the update.

**Pinning a version**: `NUDGE_VERSION` in `.env`. By default, `latest` follows the latest release. `0.1` receives the 0.1 fixes, and `0.1.2` never moves. Images built from `main`, not released, carry the `edge` tag. In production, pin an exact version and raise it on purpose, after [verifying the new image](#verifying-an-image): with `latest`, the next `pull` installs whatever was published last. The compose file pins Postgres and Redis by digest.

## Verifying an image

Every published image is signed with cosign, keyless, by the `images.yml` workflow, from `main` (`edge`) or from a release tag. The identity below accepts no other workflow and no other branch:

```bash
cosign verify ghcr.io/garage-sh/nudge:latest \
  --certificate-identity-regexp '^https://github\.com/garage-sh/nudge/\.github/workflows/images\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

To accept one release only, and no `edge` build, end the regexp with `@refs/tags/v0\.1\.2$` instead.

## Backing up

Back up the `postgres` (the source of truth), `captures` and `redis` volumes, as well as the value of `NUDGE_ENCRYPTION_KEY`. Without this key, the stored secrets (Judge key, Destination tokens) are unreadable and must be entered again.

Redis only holds the queues: a Feedback left Received goes back to Triage on its own, but a pending Delivery lost with Redis stays stuck.

## Scaling

By default, the api and the worker run in the same process (`NUDGE_ROLES=api,worker`). To replicate the worker without replicating the api, also download [`docker-compose.worker.yml`](../docker-compose.worker.yml) (attached to every release, like `docker-compose.yml`), which starts the same image with `NUDGE_ROLES=worker`:

```bash
docker compose -f docker-compose.yml -f docker-compose.worker.yml up -d --scale worker=3
```

The workers then share the queues, and a Triage spike no longer slows down collection. The api can be replicated too, but the Widget rate limit is counted in memory, per replica: with N replicas, the effective limit is multiplied by N.
