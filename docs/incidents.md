# Reporting Incidents

How an application reports what goes wrong on its side (a payment provider timing out, a queue backing up, a nightly job failing) and how nudge routes it. Feedback, what users say, is described in [Integrating a Project](integration.md).

- [How an Incident lives](#how-an-incident-lives)
- [Reporting from a server](#reporting-from-a-server)
- [Shaping a report](#shaping-a-report)
- [Routing](#routing)
- [Storms](#storms)
- [In the dashboard](#in-the-dashboard)
- [With a coding agent](#with-a-coding-agent)

## How an Incident lives

One request is one **Occurrence**. nudge groups the Occurrences that share a **Fingerprint** into one Open **Incident**: a healthcheck failing every minute is one Incident with a growing counter, not one alert per minute. The Incident keeps the counter, the first and last seen times, and the full first and last report; individual Occurrences are not stored.

An Incident has a **Level**: `info`, `warning`, `error` or `critical`. The Level the sender declares is used as is. Without one, the Judge assesses it, within a bounded wait (`NUDGE_INCIDENT_JUDGE_WAIT_MS`, 10 s); failing that, the Project's default Level applies. A later Occurrence with a higher declared Level raises the Incident's Level.

An Incident closes when:

- its sender reports it `resolved`;
- a Member closes it from the dashboard;
- no new Occurrence arrives for its **Quiet period** (one hour by default), so an application never has to know when a problem is over.

A Closed Incident never reopens: the next Occurrence with the same Fingerprint opens a new Incident, and notifies again.

## Reporting from a server

Incidents are reported with the Project's **secret key** (`nk_sec_…`) only: the public key is refused with `403 secret_key_required`, since anything shipped to a browser could report anything. Keep the key in an environment variable of the server.

With the JS SDK (`@nudge/sdk`, in `packages/sdk`, not yet published on npm):

```ts
import { createClient } from '@nudge/sdk';

const nudge = createClient({
  url: 'https://nudge.example.com',
  secretKey: process.env.NUDGE_SECRET_KEY!, // nk_sec_…
});

nudge
  .sendIncident(
    {
      title: 'Payment provider timed out',
      message: 'POST /charges took 30 s',
      level: 'error',
      environment: 'production',
      context: { service: 'checkout', version: '3.1.0' },
    },
    { signal: AbortSignal.timeout(3000) },
  )
  .catch((error) => console.warn('nudge: Incident not reported', error));
```

Or with any HTTP client:

```sh
curl https://nudge.example.com/v1/incidents \
  -H "Authorization: Bearer $NUDGE_SECRET_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Payment provider timed out","level":"error","environment":"production"}'
```

The API answers `202 { id, state, opened }`: the Incident the Occurrence landed in, `open` or `closed`, and whether this Occurrence opened it. A `resolved` Occurrence that matches no Open Incident records nothing and answers `{ id: null, state: null, opened: false }`. A refusal is `{ error, details? }`: `400 invalid_incident` (with the refused fields), `401 missing_key` or `invalid_key`, `403 secret_key_required`, `429 too_many_attempts` after too many rejected keys from one IP (with `Retry-After`).

Report fire-and-forget, with a short timeout: reporting an Incident should never slow down or break the application. The API answers without waiting for the Judge.

The fields, their bounds and the error codes are described in [`docs/api/openapi.json`](api/openapi.json). The body is strict: an unknown field refuses the Occurrence.

## Shaping a report

| Field         | Set it (bounds in the [OpenAPI document](api/openapi.json))                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | Always. Keep it stable across Occurrences of the same problem: without a Fingerprint, the title and the Environment decide the grouping.                                         |
| `fingerprint` | When the title carries a variable part (an id, a duration): `payments:charge-timeout` groups every timeout into one Incident, whatever its title.                                |
| `level`       | Whenever the code knows how serious the failure is: the Incident is then dispatched at once, without waiting for the Judge.                                                      |
| `environment` | Always, if the application runs in several (`production`, `staging`…). An Incident without an Environment passes only the Incident Filters that accept every Environment.        |
| `message`     | The detail of what went wrong.                                                                                                                                                   |
| `context`     | What whoever reads the Incident needs to act: version, host, service, trace link. Flat scalar values. Destinations can route on it; it never changes the Fingerprint.            |
| `quietPeriod` | For a report with its own rhythm: seconds the Incident stays Open without a new Occurrence. The last Occurrence's value counts; without one, the Project's Quiet period applies. |
| `resolved`    | `true` when the application sees the recovery (a healthcheck passing again). It closes the Open Incident with the same Fingerprint, and opens none.                              |

Title, message and context reach chat channels, issues and emails: keep secrets and personal data out of them.

## Routing

Each Destination carries an **Incident Filter** beside its Feedback Filter, edited in the same form; either one can be off, and a Destination created before Incidents existed has it off. The Incident Filter has a minimum Level, a list of accepted Environments (empty accepts all) and conditions on the context (`key` is one of these values, all required; a missing key fails).

A Destination is notified when an Incident opens, when its Level rises enough to reach a Destination that had not received it (only that one), and when it closes. On close, each adapter acts on what it created: Linear and GitHub close the issue and comment on it, Discord edits the opening message, email sends a closing mail that replies to the opening one, the webhook sends `incident.closed`. A Slack incoming webhook cannot thread or edit, so the closing is its own message. A Destination that was Suspended while an Incident opened and closed receives it once, as "opened then closed".

The webhook events and their payloads are in [Webhooks](webhooks.md).

## Storms

The **Opening cap** bounds how many Incidents a Project may open per minute and still dispatch (20 by default). Past it, Incidents are recorded but **Held**: they go to no Destination. The Alert destination is warned once per Storm (`incident_storm`), and once the Project has gone a full minute without a Held opening, each Destination whose Incident Filter accepts at least one Held Incident receives a single summary instead. A Member can Redispatch a Held Incident that is still Open.

A Storm usually means titles that vary without a Fingerprint: fix the integration rather than raise the cap.

## In the dashboard

- The Project's **Incidents** tab lists its Incidents, Open and Closed, filtered by state, Level, Environment and Held. The detail shows the Level and where it came from, the counter, first and last seen, the first and last report, the context and the Deliveries, with **Close**, **Redispatch**, replay of a failed Delivery and **Delete**.
- The Project's **Settings** have an **Incidents** panel: default Level, Quiet period, Opening cap, and an example request.
- Incidents follow the Instance's Retention, by the time they were last seen.

The Instance defaults (Quiet period, Opening cap, Judge wait) are environment variables, listed in [Configuration](configuration.md#incidents).

## With a coding agent

The `integrate-nudge-incidents` skill teaches a coding agent where to hook reporting in your application, how to shape each report, and which values to ask you for. Install it in the application's repository:

```sh
npx skills add garage-sh/nudge --skill integrate-nudge-incidents
```

Then ask your agent to report the application's Incidents to nudge, and give it the Instance URL and the Project's secret key. The skill lives in [`skills/integrate-nudge-incidents`](../skills/integrate-nudge-incidents/SKILL.md).
