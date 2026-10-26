<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
    <img src="docs/assets/logo.svg" alt="nudge" height="48" />
  </picture>
</h1>

[![CI](https://github.com/garage-sh/nudge/actions/workflows/ci.yml/badge.svg)](https://github.com/garage-sh/nudge/actions/workflows/ci.yml)
[![Images](https://github.com/garage-sh/nudge/actions/workflows/images.yml/badge.svg)](https://github.com/garage-sh/nudge/pkgs/container/nudge)
[![License AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

nudge collects feedback from the users of several applications, triages it and sends it where the team works. It is open-source (AGPL-3.0) and self-hosted.

Each **Project** embeds the **Widget**, or calls the public API from its server. Incoming **Feedback** goes through **Triage**: a **Judge**, a System One decision model (through TypeSafe, OpenRouter or your own server), determines its Type and Severity, and spots Junk feedback and Manipulation attempts. It is then dispatched to the Project's **Destinations** (signed webhook, Discord, Linear, Slack, GitHub Issues) whose **Filter** accepts it. **Members** follow everything from a dashboard, available in English and French (language selector in the dashboard).

The vocabulary is defined in [`CONTEXT.md`](CONTEXT.md), and architecture decisions are in [`docs/adr/`](docs/adr/).

## Running an Instance

You need Docker and Docker Compose v2. An Instance is made of four containers: `nudge` (the api and the worker), `dashboard`, Postgres and Redis. A fifth container, `migrate`, applies the migrations then stops. The images are published to `ghcr.io/garage-sh/nudge` and `ghcr.io/garage-sh/nudge-dashboard`, for amd64 and arm64.

No need to clone the repository: the compose file and the example configuration are enough.

```bash
mkdir nudge && cd nudge
curl -fsSL -o docker-compose.yml https://github.com/garage-sh/nudge/releases/latest/download/docker-compose.yml
curl -fsSL -o .env https://github.com/garage-sh/nudge/releases/latest/download/env.example
```

In `.env`, fill in the two required variables:

```bash
NUDGE_ENCRYPTION_KEY=$(openssl rand -base64 32)   # the value, not the command
NUDGE_POSTGRES_PASSWORD=$(openssl rand -hex 24)
```

Then:

```bash
docker compose up -d
```

When `docker compose ps` shows `nudge` as `healthy`, open <http://localhost:8080>. The first screen creates the first Member. It asks for the setup token, which only someone with access to the server knows: the `nudge` container prints it at startup while no Member exists.

```bash
docker compose logs nudge | grep 'setup token'
```

The token is derived from `NUDGE_ENCRYPTION_KEY`, so every api replica prints the same one; set `NUDGE_SETUP_TOKEN` (16 characters or more) to choose it yourself. Once the first Member exists, the setup closes for good. The next Members are invited from the dashboard, with an invitation link; any Member can remove another one from the **Members** screen, where each Member also changes their password and signs out their other sessions.

You can then:

1. create a **Project**. Its public and secret keys are shown only once: write them down, or regenerate them later;
2. declare its **Allowed origins**, that is the sites where the Widget is installed (`https://app.example.com`);
3. add **Destinations**, with their Filter, and test them from the dashboard;
4. choose the **Judge** in **Settings**. Without a Judge, nudge runs in degraded mode: it detects neither Severity, nor Junk, nor Manipulation, and every Verdict is Uncertain.

### What the published port serves

Only the `dashboard` container publishes a port (`NUDGE_PORT`, 8080 by default). It serves everything on the same origin:

| Path                      | Content                                                   |
| ------------------------- | --------------------------------------------------------- |
| `/`                       | the Members' dashboard                                    |
| `/api/…`                  | the dashboard API (cookie session), relayed to `nudge`    |
| `/v1/feedbacks`           | the public ingestion (Widget and SDK), relayed to `nudge` |
| `/widget/nudge-widget.js` | the Widget for the script tag                             |

Because everything is served on the same origin, the session cookie stays first-party, without CORS.

### In production: HTTPS

Put a TLS reverse proxy (Caddy, Traefik, nginx…) in front of the published port, then set:

- `NUDGE_DASHBOARD_URL=https://nudge.example.com` so that Deliveries and alerts carry a link to the Feedback;
- `NUDGE_TRUST_PROXY=2`, that is your proxy plus the dashboard's. The api reads the client IP from `X-Forwarded-For`, which the Widget rate limit and the sign-in brute-force protection rely on.

The published port listens on `127.0.0.1` only (`NUDGE_BIND`): a proxy on the same host reaches it, the network does not. A proxy running as a container can also join the compose network and target `dashboard:8080`; it counts as one hop all the same. Both values of `NUDGE_TRUST_PROXY` are wrong in one direction:

- **too high** (`2` while clients can reach the port without going through your proxy): a client sends its own `X-Forwarded-For` and chooses its IP, so it is never throttled. If your proxy runs on another machine and you set `NUDGE_BIND=0.0.0.0`, firewall the port so that only the proxy reaches it; Docker publishes ports past `ufw` and `firewalld` rules;
- **too low** (`1`, the default, behind a proxy): every client shares the proxy's IP. Ten sign-in attempts per minute from anyone then lock every Member out of sign-in, and all the Widgets share a single 20 Feedbacks per minute budget.

The session cookie is `Secure`, so HTTPS is required. Browsers make an exception for `http://localhost`. To try the Instance over HTTP from another machine, `NUDGE_BIND=0.0.0.0` and `NUDGE_COOKIE_SECURE=false` lift these protections (keep `NUDGE_TRUST_PROXY=1`), but never do it on an exposed Instance.

Before opening the Instance to real Authors, read [Operating an Instance](SECURITY.md#operating-an-instance): Triage routing, the per-Project Widget budget and invitation links in logs.

### Updating, backing up, scaling

- **Updating**: `docker compose pull && docker compose up -d`. The `migrate` service applies the new migrations before `nudge` restarts. Read the [release notes](https://github.com/garage-sh/nudge/releases) before changing minor version. There are no down migrations: going back to a previous version means restoring the Postgres backup taken before the update.
- **Pinning a version**: `NUDGE_VERSION` in `.env`. By default, `latest` follows the latest release. `0.1` receives the 0.1 fixes, and `0.1.2` never moves. Images built from `main`, not released, carry the `edge` tag. In production, pin an exact version and raise it on purpose, after verifying the new image: with `latest`, the next `pull` installs whatever was published last. The compose file pins Postgres and Redis by digest.
- **Verifying an image**: every published image is signed with cosign, keyless, by the `images.yml` workflow, from `main` (`edge`) or from a release tag. The identity below accepts no other workflow and no other branch:

  ```bash
  cosign verify ghcr.io/garage-sh/nudge:latest \
    --certificate-identity-regexp '^https://github\.com/garage-sh/nudge/\.github/workflows/images\.yml@refs/(heads/main|tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?)$' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com
  ```

  To accept one release only, and no `edge` build, end the regexp with `@refs/tags/v0\.1\.2$` instead.

- **Backing up**: the `postgres` (the source of truth), `captures` and `redis` volumes, as well as the value of `NUDGE_ENCRYPTION_KEY`. Without this key, the stored secrets (Judge key, Destination tokens) are unreadable and must be entered again. Redis only holds the queues: a Feedback left Received goes back to Triage on its own, but a pending Delivery lost with Redis stays stuck.
- **Scaling**: by default, the api and the worker run in the same process (`NUDGE_ROLES=api,worker`). To replicate the worker without replicating the api, also download [`docker-compose.worker.yml`](docker-compose.worker.yml) (attached to every release, like `docker-compose.yml`), which starts the same image with `NUDGE_ROLES=worker`:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.worker.yml up -d --scale worker=3
  ```

  The workers then share the queues, and a Triage spike no longer slows down collection. The api can be replicated too, but the Widget rate limit is counted in memory, per replica: with N replicas, the effective limit is multiplied by N.

## Configuration

All configuration goes through environment variables. [`.env.example`](.env.example) describes them one by one. An empty variable takes its default value. An invalid value prevents the server from starting, and the error names the faulty variable.

| Variable                                                                                                             | Role                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `NUDGE_ENCRYPTION_KEY`                                                                                               | **Required.** Instance key (32 bytes, base64): encrypts the secrets stored in the database with AES-256-GCM |
| `NUDGE_POSTGRES_PASSWORD`                                                                                            | **Required** (compose). Postgres password                                                                   |
| `NUDGE_VERSION`, `NUDGE_ROLES`                                                                                       | Image version (compose, `latest`) and what the process runs (`api`, `worker`, default `api,worker`)         |
| `NUDGE_BIND`, `NUDGE_PORT`, `NUDGE_DASHBOARD_URL`, `NUDGE_COOKIE_SECURE`, `NUDGE_TRUST_PROXY`, `NUDGE_SETUP_TOKEN`   | Access: published address and port, public URL, HTTPS-only cookie, trusted proxies, setup token             |
| `NUDGE_WIDGET_RATE_LIMIT_IP`, `NUDGE_WIDGET_RATE_LIMIT_PROJECT`                                                      | Widget rate limit, in Feedbacks per minute (20 per IP, 600 per Project)                                     |
| `NUDGE_OUTBOUND_ALLOWED_HOSTS`                                                                                       | Internal hosts a Member-configured URL may reach (webhooks, Judge base URL); none by default                |
| `NUDGE_JUDGE_PROVIDER`, `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL`, `NUDGE_JUDGE_BASE_URL`, `NUDGE_JUDGE_TIMEOUT_MS` | Default Judge, and timeout of a request to the Judge (30 s)                                                 |
| `NUDGE_TRIAGE_JUNK_THRESHOLD`, `NUDGE_TRIAGE_MANIPULATION_THRESHOLD`, `NUDGE_TRIAGE_CONFIDENCE_THRESHOLD`            | Thresholds of the Verdict policy (0.8, 0.7, 0.6)                                                            |
| `NUDGE_SUSPENSION_FAILURE_THRESHOLD`, `NUDGE_SUSPENSION_COOLDOWN_MS`, `NUDGE_SUSPENSION_PROBE_INTERVAL_MS`           | Destination suspension (5 failures, 5 min, probe every minute)                                              |
| `NUDGE_PURGE_INTERVAL_MS`                                                                                            | Period of the Retention purge (1 h)                                                                         |
| `NUDGE_CAPTURES_STORAGE`, `NUDGE_CAPTURES_DIR`, `NUDGE_S3_*`                                                         | Capture storage: `disk` or S3-compatible (`s3`)                                                             |

### Judge

The Judge is chosen in the dashboard (**Settings**), and its key is stored there encrypted. The `NUDGE_JUDGE_PROVIDER`, `NUDGE_JUDGE_API_KEY`, `NUDGE_JUDGE_MODEL` and `NUDGE_JUDGE_BASE_URL` variables are only a fallback as long as no Judge is chosen; `NUDGE_JUDGE_TIMEOUT_MS` always applies. Three providers are available:

- `typesafe`: TypeSafe System One (Jev, `jev-latest` by default). It requires `NUDGE_JUDGE_API_KEY`;
- `openrouter`: pplx-decider through OpenRouter's Decisions API (`perplexity/pplx-decider-v1.2` by default). It requires `NUDGE_JUDGE_API_KEY`;
- `self_hosted`: any server that exposes the Decisions API (a self-hosted pplx-decider, for example; `pplx-decider-flash-v1.2` by default). It requires `NUDGE_JUDGE_BASE_URL`, and the key is optional.

Only the Feedback text, its non-personal context and the Project description are sent to the Judge, and only as data. The Capture is never sent to it.

### Outbound calls

Members type the URLs that nudge calls: a webhook Destination or Alert destination, a Judge base URL. So that they cannot reach the Instance's own network, the api and the worker only connect to public addresses. Loopback, private, link-local (cloud metadata), CGNAT, unique local and multicast addresses are refused, IPv4 and IPv6 alike, on the address actually connected to after DNS resolution. The test buttons answer with the refusal.

To send webhooks to a host on your network, or to choose a self-hosted Judge in the dashboard, list that host in `NUDGE_OUTBOUND_ALLOWED_HOSTS`: host names (exact match, such as `hooks.lan` or a compose service like `decider`), IP addresses or CIDR ranges (`192.168.1.0/24`), comma-separated. Every Member can then target it. `0.0.0.0/0,::/0` turns the check off. The `NUDGE_JUDGE_*` Judge, which only you configure, is not checked.

### Captures

By default, Captures are written to disk (`NUDGE_CAPTURES_STORAGE=disk`), in the `captures` volume that the api and the worker share. For S3-compatible object storage (AWS S3, MinIO, Garage…), set `NUDGE_CAPTURES_STORAGE=s3` as well as `NUDGE_S3_ENDPOINT`, `NUDGE_S3_BUCKET`, `NUDGE_S3_ACCESS_KEY_ID` and `NUDGE_S3_SECRET_ACCESS_KEY`. `NUDGE_S3_REGION` (`us-east-1`), `NUDGE_S3_PREFIX` and `NUDGE_S3_FORCE_PATH_STYLE` (`true`) are optional. Captures already on disk are not migrated to S3.

## Integrating a Project

### Widget: script tag

```html
<script
  src="https://nudge.example.com/widget/nudge-widget.js"
  data-public-key="nk_pub_…"
  data-api="https://nudge.example.com"
></script>
```

The Widget adds a "Send feedback" button to the page, which opens a form. It is isolated in a Shadow DOM: its CSS and the page's do not interfere. It is only accepted from the Project's **Allowed origins**. It automatically attaches the page URL (without its `#fragment`, see **Page URL** below), the browser, the OS and the screen size.

**Language.** The Widget speaks English and French. Without a `locale`, it follows the page's `<html lang>`, then the browser's language: French if either is French, English otherwise. To force it, add `data-locale="en"` or `data-locale="fr"` to the script tag (or the `locale` option below).

To pass the signed-in user's identity and metadata, omit `data-public-key` and `data-api` and mount the Widget yourself:

```html
<script src="https://nudge.example.com/widget/nudge-widget.js"></script>
<script>
  Nudge.mountWidget({
    publicKey: 'nk_pub_…',
    api: 'https://nudge.example.com',
    author: { id: 'u-42', email: 'ada@example.com', name: 'Ada' },
    metadata: { version: '2.3.1', environment: 'production' },
    locale: 'en', // optional: 'en' | 'fr', detected when omitted
    redactUrl: (url) => url.origin + url.pathname, // optional: see "Page URL" below
  });
</script>
```

The script also defines the `<nudge-widget>` custom element, which you can place yourself: `<nudge-widget public-key="nk_pub_…" api="https://nudge.example.com" locale="fr"></nudge-widget>`, with `author`, `metadata` and `redactUrl` set as properties.

**Page URL.** By default, the Widget sends the page URL without its fragment (`#…`), where tokens often travel (OAuth implicit flow, magic links). If the URL carries other sensitive data, such as a token or a personal ID in the query string, pass `redactUrl`. It receives the full page URL as a `URL` (fragment included) and returns the URL to send (a `URL` or a string), or `null` to send none. For example, to drop a query parameter:

```js
redactUrl: (url) => {
  url.searchParams.delete('token');
  return url;
},
```

If `redactUrl` throws or returns something other than an absolute URL, the Feedback is sent without a URL rather than with the unredacted one.

An identity coming from the browser is recorded as **declared**, never as attested: anyone can forge it. For a trustworthy identity, send the Feedback from your server with the SDK.

**Captures.** The Author can tick "Attach a screenshot of the page". They then see a preview, on which they can blur areas before sending, and nothing is captured without their consent. Mark sensitive elements with `data-nudge-mask`: they are always masked, in the browser, before the image leaves the page. This covers open Shadow DOMs and same-origin iframes too. An iframe whose content the page cannot read (another site, a sandbox) is always masked whole.

```html
<div data-nudge-mask>IBAN: FR76 …</div>
```

### Widget: React component

`@nudge/widget` (in `packages/widget`) also provides the web component as ESM and a React wrapper. The package is not yet published on npm.

```tsx
import { NudgeWidget } from '@nudge/widget/react';

<NudgeWidget
  publicKey="nk_pub_…"
  api="https://nudge.example.com"
  author={{ id: user.id }}
  locale="en"
/>;
```

### JS SDK: from a server

`@nudge/sdk` (in `packages/sdk`, not yet published on npm) posts Feedback with the Project's **secret key**. The Author passed is then **attested**. The Feedback's Source is `api`. The secret key must never leave the server.

```ts
import { createClient, NudgeError } from '@nudge/sdk';

const nudge = createClient({
  url: 'https://nudge.example.com',
  secretKey: process.env.NUDGE_SECRET_KEY!, // nk_sec_…
});

try {
  const { id } = await nudge.sendFeedback({
    text: 'I cannot download my invoice',
    type: 'bug', // optional: bug | suggestion | opinion | question
    author: { id: 'u-42', email: 'ada@example.com' },
    context: { url: 'https://app.example.com/invoices', metadata: { plan: 'pro' } },
  });
} catch (error) {
  if (error instanceof NudgeError) console.error(error.status, error.code, error.details);
}
```

The Instance `url` must use HTTPS: the secret key travels in every request, and `createClient` throws on a plain `http://` URL. The only exception is the machine itself (`localhost`, `127.0.0.1`, `[::1]`), for local development.

The SDK does not retry a submission on its own. Pass `{ signal }` as the second argument to bound the call in time.

### HTTP API

The Widget and the SDK both call `POST /v1/feedbacks`, with the `Authorization: Bearer <key>` header. The public key is the Widget's and requires the `Origin` header; the secret key is the server's.

| Field     | Content                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| `text`    | required, 5,000 characters at most                                                      |
| `type`    | optional: `bug`, `suggestion`, `opinion` or `question`                                  |
| `author`  | optional: `id`, `email`, `name`                                                         |
| `context` | optional: `url`, `userAgent`, `viewport {width, height}`, `metadata` (50 keys at most)  |
| `capture` | optional: `{ contentType: 'image/png' \| 'image/jpeg', data: <base64> }`, 2 MiB at most |

The API answers `202 { id, state: 'received' }`. On refusal, it returns `{ error, details? }` with one of these codes:

- `400 invalid_feedback`: the body is malformed (`details` lists the refused fields as `{ path, message }`);
- `401 missing_key` or `invalid_key`: the key is missing or rejected;
- `403 origin_refused`: the origin is not allowed for this Project;
- `429 too_many_feedbacks`: the rate limit is reached. The response carries `Retry-After`.

### Webhook Destination

A webhook Destination receives a JSON `POST` per event. Its signing secret is generated by the Instance and shown only once, when the Destination is created (it can be regenerated from the dashboard). Redirects are not followed, and any non-2xx response counts as a failure. A receiver on your own network must be listed in `NUDGE_OUTBOUND_ALLOWED_HOSTS` (see [Outbound calls](#outbound-calls)).

| Header                               | Content                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `X-Nudge-Event`                      | `feedback`, `alert` (when the webhook is the Alert destination) or `ping` (health probe) |
| `X-Nudge-Delivery` / `X-Nudge-Alert` | stable id of the Delivery or the alert: use it to ignore a retried delivery              |
| `X-Nudge-Timestamp`                  | Unix time, in seconds                                                                    |
| `X-Nudge-Signature`                  | `sha256=<hex>`: HMAC-SHA256 of `<timestamp>.<raw body>` with the signing secret          |

A `feedback` event looks like this (`isTest` is `true` for the dashboard's test button):

```json
{
  "event": "feedback",
  "isTest": false,
  "delivery": { "id": "…" },
  "project": { "id": "…", "name": "Billing" },
  "feedback": {
    "id": "…",
    "text": "I cannot download my invoice",
    "source": "widget",
    "type": "bug",
    "severity": "major",
    "uncertain": false,
    "author": { "id": "u-42", "email": "ada@example.com", "name": null, "trust": "declared" },
    "context": { "url": "https://app.example.com/invoices" },
    "capture": null,
    "receivedAt": "2026-10-25T09:30:00.000Z",
    "dashboardUrl": "https://nudge.example.com/…"
  }
}
```

`capture` is `{ contentType, data }` (base64) when the Feedback has one. An `alert` event carries `alert: { id, type, at, title, summary, project, dashboardUrl }`, plus `feedback: { id }` for `feedback_in_review` or `destination: { id, name, failureClass, message }` for `destination_suspended`. The text is sent raw, as the Author wrote it: encode it for wherever you display it.

To verify the signature, recompute it over the raw body, before parsing it:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyNudgeSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const timestamp = headers.get('x-nudge-timestamp') ?? '';
  const signature = headers.get('x-nudge-signature') ?? '';
  // Reject deliveries older than 5 minutes, against replays.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}
```

## Development

You need Node 26 (`.nvmrc`) and Docker. Yarn 4 is shipped in the repository (`.yarn/releases`).

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

The api and the `db:*` scripts read the root `.env`; a variable already exported in the shell takes precedence. The other variables are described in `.env.example`.

`yarn dev` runs `dev:infra` again, builds the packages the apps depend on, then starts the api (with the worker) and the dashboard in watch mode. A single app: `yarn workspace @nudge/api dev`. The worker is the `packages/worker` library, which the api starts according to `NUDGE_ROLES`.

`yarn dev:reset` starts over from an empty local Instance: it drops the Postgres volume and the Redis queues, deletes the Captures in `.data/captures`, restarts the infrastructure and applies the migrations.

To build and run the images from source rather than pulling them from ghcr.io:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

To check a change:

- `yarn check-types` checks the types;
- `yarn test` runs the tests (the pipeline tests start Postgres and Redis with testcontainers);
- `yarn workspace @nudge/widget test:e2e` runs the Widget's browser tests (Playwright);
- `yarn lint` runs the linter.

To contribute, read [`CONTRIBUTING.md`](CONTRIBUTING.md). To report a vulnerability, read [`SECURITY.md`](SECURITY.md).

## License

[AGPL-3.0](LICENSE). If you modify nudge and offer it as a service, you must publish your modifications.
