<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg" />
    <img src="docs/assets/logo.svg" alt="nudge" height="48" />
  </picture>
</h1>

[![CI](https://github.com/garage-sh/nudge/actions/workflows/ci.yml/badge.svg)](https://github.com/garage-sh/nudge/actions/workflows/ci.yml)
[![Images](https://github.com/garage-sh/nudge/actions/workflows/images.yml/badge.svg)](https://github.com/garage-sh/nudge/pkgs/container/nudge)
[![License AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)

nudge is the place where your applications' signals meet your team. It listens to two of them, for every application you run:

- **Feedback**: what your users say. A bug they hit, a feature they miss, an opinion, a question.
- **Incidents**: what your applications report going wrong. A payment provider timing out, a queue backing up, a nightly job failing.

Both reach one self-hosted Instance, which makes sense of them and sends each one where the team already works: an issue in Linear or GitHub, a message in Slack, Discord or Telegram, an email, a signed webhook. Each Project chooses what goes where, so a blocking bug and a critical outage reach the people on call while a suggestion lands in the backlog. nudge is open-source (AGPL-3.0) and runs on your own servers: you decide where your users' words and your production failures go.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/flow-dark.svg" />
  <img src="docs/assets/flow.svg" alt="Feedback from users and Incidents from servers, sent by several applications, reach nudge, which triages the Feedback, groups the Incidents, and dispatches both to Linear, GitHub Issues, Slack, Discord, email and webhooks" width="100%" />
</picture>

### What it does

|                                 | Feedback                                                                                                                                                      | Incidents                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Who speaks**                  | The users of your application                                                                                                                                 | Your application's servers                                                                                                                                                                                     |
| **How it arrives**              | An embeddable Widget (with optional, consent-based screenshots), the server SDK, or the HTTP API                                                              | The server SDK (`sendIncident`) or the HTTP API                                                                                                                                                                |
| **How nudge makes sense of it** | A Judge, a System One decision model (TypeSafe, OpenRouter or your own server), resolves its Type and Severity, and sets aside Junk and Manipulation attempts | Repeated Occurrences are grouped into one Incident, whose Level the sender declares or the Judge assesses; it closes when the sender says it is resolved or when it stays quiet, and its Destinations are told |
| **Where a Member steps in**     | Approve or reject a Feedback held In review, reinstate one set aside as Junk, correct a Verdict, redispatch                                                   | Close an Incident, redispatch it                                                                                                                                                                               |

Both share the same **Destinations**: each carries a Feedback Filter and an Incident Filter, so one Slack channel can take every Critical Incident and every Blocking bug, and nothing else. A dashboard, in English or French, shows everything: the Inbox to triage Feedback, each Project's Incidents, the routing of each Project, and every Delivery with its status.

## Quick start

You need Docker and Docker Compose v2. No need to clone the repository: the compose file and the example configuration are enough.

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

Start the Instance, then read the setup token it prints:

```bash
docker compose up -d
docker compose logs nudge | grep 'setup token'
```

When `docker compose ps` shows `nudge` as `healthy`, open <http://localhost:8080> and create the first Member with that token. Then:

1. create a **Project**. Its public and secret keys are shown only once: write them down, or regenerate them later;
2. declare its **Allowed origins**, that is the sites where the Widget is installed (`https://app.example.com`);
3. add **Destinations**, with their Filter, and test them from the dashboard;
4. choose the **Judge** in **Settings**. Without one, nudge runs in degraded mode and every Verdict is Uncertain.

Before exposing the Instance, put it behind HTTPS: see [In production: HTTPS](docs/self-hosting.md#in-production-https).

## Sending Feedback

The quickest path is the Widget's script tag, on any page of a site listed in the Project's Allowed origins:

```html
<script
  src="https://nudge.example.com/widget/nudge-widget.js"
  data-public-key="nk_pub_…"
  data-api="https://nudge.example.com"
></script>
```

From a server, with an identity you can vouch for, use the SDK and the Project's secret key:

```ts
import { createClient } from '@nudge/sdk';

const nudge = createClient({
  url: 'https://nudge.example.com',
  secretKey: process.env.NUDGE_SECRET_KEY!,
});
await nudge.sendFeedback({ text: 'I cannot download my invoice', author: { id: 'u-42' } });
```

Or let a coding agent do the integration: `npx skills add garage-sh/nudge --skill integrate-nudge`. Every path is described in [Integrating a Project](docs/integration.md).

## Reporting Incidents

The same server can report what goes wrong on its side. nudge groups repeated Occurrences into one Incident, routes it by Level, Environment and context, and tells the Destinations when it closes, on the sender's word or after a Quiet period:

```ts
await nudge.sendIncident({
  title: 'Payment provider timed out',
  level: 'error',
  environment: 'production',
});
```

The coding agent skill is `integrate-nudge-incidents`. Read [Reporting Incidents](docs/incidents.md).

## Documentation

| Read                                             | For                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| [Integrating a Project](docs/integration.md)     | Widget (identity, language, page URL, Captures), React, JS SDK, HTTP API, coding agent |
| [Reporting Incidents](docs/incidents.md)         | Incidents from an application's server: grouping, Level, closing, routing, Storms      |
| [Destinations](docs/destinations.md)             | Destination types and what each needs; setting up Telegram                             |
| [Webhooks](docs/webhooks.md)                     | Webhook Destination: headers, payload, signature verification                          |
| [Self-hosting](docs/self-hosting.md)             | HTTPS and proxies, updating, verifying images, backing up, scaling                     |
| [Configuration](docs/configuration.md)           | Every environment variable, the Judge, outbound calls, Capture storage                 |
| [`SECURITY.md`](SECURITY.md)                     | Reporting a vulnerability, operating an Instance safely                                |
| [`docs/api/openapi.json`](docs/api/openapi.json) | The public API (OpenAPI 3.1)                                                           |
| [`CONTEXT.md`](CONTEXT.md)                       | The domain vocabulary (Project, Feedback, Triage, Verdict, Destination…)               |
| [`docs/adr/`](docs/adr/)                         | Architecture decisions                                                                 |

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md), then [Development](docs/development.md) to run nudge from source. To report a vulnerability, read [`SECURITY.md`](SECURITY.md).

## License

[AGPL-3.0](LICENSE). If you modify nudge and offer it as a service, you must publish your modifications.
