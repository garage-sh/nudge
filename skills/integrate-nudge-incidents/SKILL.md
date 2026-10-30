---
name: integrate-nudge-incidents
description: Report an application's Incidents to nudge, the self-hosted feedback and incident router. Use when an application should send its failures (unhandled errors, failed background jobs, failed healthchecks, failed third-party calls) to a nudge Instance, or when wiring `sendIncident` or `POST /v1/incidents`.
---

# Integrate nudge Incidents

nudge routes what an application reports going wrong on its side. Each application is a **Project** of a self-hosted **Instance**. One request is one **Occurrence**; nudge groups the Occurrences that share a **Fingerprint** into one Open **Incident**, gives it a **Level**, and dispatches it to the Project's Destinations whose Incident Filter accepts it. The Incident closes when the sender reports it `resolved`, when a Member closes it, or on its own after a **Quiet period** without a new Occurrence. A Closed Incident never reopens: the next Occurrence opens a new one.

What users say about the application is Feedback, the job of the sibling skill `integrate-nudge` (`npx skills add garage-sh/nudge --skill integrate-nudge`).

The contract of `POST /v1/incidents` is the OpenAPI document, the single source of truth for fields, bounds and error codes: <https://github.com/garage-sh/nudge/releases/latest/download/openapi.json>. Fetch it before writing a payload by hand.

## 1. Collect the Instance values

Every value below comes from the human, who reads it in the Instance's dashboard. Ask for the ones you are missing, and stop until you have them: an invented key or URL fails at runtime.

- **Instance URL** — `https://nudge.example.com`, HTTPS.
- **Secret key** (`nk_sec_…`) — of the Project the application belongs to. Treat it as a password. The public key (`nk_pub_…`) is refused: Incidents are reported from a server only.

Done when you hold both values, and they live in the server's environment as `NUDGE_URL` and `NUDGE_SECRET_KEY` (out of the repository, out of any client bundle).

## 2. Implement the reporter

Write one `reportIncident` function, server side, that every hook calls. It is **fire-and-forget**: bounded by a short timeout, never awaited by the code path that failed, and it swallows its own failure after a local log. Reporting must never throw into the application, slow a request, or report itself in a loop.

If the project depends on `@nudge/sdk`:

```ts
import { createClient, type IncidentInput } from '@nudge/sdk';

const nudge = createClient({
  url: process.env.NUDGE_URL!,
  secretKey: process.env.NUDGE_SECRET_KEY!,
});

export function reportIncident(occurrence: IncidentInput): void {
  nudge
    .sendIncident(occurrence, { signal: AbortSignal.timeout(3000) })
    .catch((error) => console.warn('nudge: Incident not reported', error));
}
```

`createClient` throws on a plain `http://` URL (except `localhost`, `127.0.0.1`, `[::1]`) and on a public key; a refusal rejects with a `NudgeError` carrying `status`, `code` and `details`. The SDK never retries.

Otherwise post the JSON yourself, in any language:

```ts
export function reportIncident(occurrence: Record<string, unknown>): void {
  fetch(`${process.env.NUDGE_URL}/v1/incidents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NUDGE_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(occurrence),
    signal: AbortSignal.timeout(3000),
  })
    .then((response) => {
      if (!response.ok) console.warn('nudge: Incident refused', response.status);
    })
    .catch((error) => console.warn('nudge: Incident not reported', error));
}
// 202 { id, state: 'open' | 'closed', opened }; otherwise { error, details? }
```

On a runtime that freezes the process once the response is sent (serverless, edge functions), hand the promise to the platform's `waitUntil`, or await it: the timeout still bounds it.

Done when `reportIncident` exists, reads both values from the environment, and cannot throw.

## 3. Shape each Occurrence

These are the decisions agents get wrong; the OpenAPI document has every bound.

- **`title`** (required, 300 characters) — what is going wrong, stable across Occurrences of the same problem: `Payment provider timed out`, not `Charge ch_8f2k timed out`.
- **`fingerprint`** (255 characters) — set it whenever the title must carry a variable part (an id, a count, a duration). Without it, nudge derives one from the title and the Environment, so every distinct title opens its own Incident: a flood, and past the Project's Opening cap the Incidents are Held instead of dispatched. Name the problem, not the instance: `payments:charge-timeout`.
- **`level`** — `info`, `warning`, `error` or `critical`. Declare it whenever the code knows how serious the failure is: an undeclared Level waits up to about ten seconds for the Judge, then falls back to the Project's default Level. A higher Level on a later Occurrence raises the Incident; a lower one never lowers it. Destinations route by minimum Level, so agree the mapping with the human.
- **`environment`** (100 characters) — always send it, from the deployment's own variable (`production`, `staging`…). An Incident without an Environment passes only the Incident Filters that accept every Environment.
- **`message`** (5,000 characters) — the detail: the error message, the failing step. Bound it; a stack trace fits if trimmed.
- **`context`** — what whoever reads the Incident needs to act: `service`, `version`, `host`, `jobId`, a trace link. Flat: 50 keys at most, values strings (1,000 characters), numbers, booleans or `null`. Destinations can route on its values. It never changes the Fingerprint.
- **`quietPeriod`** — seconds (1 to 2,592,000) the Incident stays Open without a new Occurrence. The default is the Project's (one hour unless the human changed it). Set it when the failing thing reports at its own rhythm: a job that runs hourly reports at most once an hour, so give it more than its interval (`7200`). The last Occurrence's value counts, so send it on every Occurrence of that hook.
- **`resolved: true`** — send it when the code itself sees the recovery: the healthcheck passes again, the job succeeds after failing. Use the same `title` and `environment` (or the same `fingerprint`) as the failure, so it matches the Open Incident and closes it. Matching nothing records nothing (`id: null`), so a hook that keeps no state may send it on every success.
- **Strict object.** An unknown field (`severity`, `tags`, `user`, `stack`…) refuses the Occurrence with `400 invalid_incident`. Anything specific to the application goes in `context`.

**Never put secrets or personal data** in `title`, `message` or `context`: they are shown in chat channels, issues and emails. Technical ids (job, order, request) are fine; emails, names, tokens, request bodies, headers and cookies stay out. When reporting a caught error, build the message from the error's message, never from the input that caused it.

## 4. Hook the reporter

Call `reportIncident` where the application learns that something the team must act on failed, once the failure is final:

- **Global error handler** — the framework's error middleware and `process.on('unhandledRejection')` / `uncaughtException`: the 5xx the application did not handle. A user's own mistake (a 4xx, a validation error) is not an Incident.
- **Failed background job** — in the job runner's failure hook, after the last retry, with the job name in the title or Fingerprint and its id in `context`.
- **Failed healthcheck** — each failing check reports (the Open Incident absorbs the repeats); the first passing check after a failure reports `resolved: true`.
- **Failed third-party call** — once the client's own retries are exhausted, with the provider in the title or Fingerprint.

Done when each hook the human agreed on calls `reportIncident` with a stable title or a Fingerprint, a Level and an Environment.

## Errors

The body is `{ error, details? }`; `details` lists the refused fields of a `400 invalid_incident`. `401` (`missing_key`, `invalid_key`) and `403 secret_key_required` (a public key was sent) are configuration, for the human to fix. `429 too_many_attempts` follows too many rejected keys from one IP; it carries `Retry-After`. A reporter retries none of them: it logs and moves on.

## 5. Verify

Send one test Occurrence from the application's server, with its real configuration: `{ title: 'nudge integration test', level: 'info', environment: <the deployment's> }`. Tell the human first: it reaches every Destination whose Incident Filter accepts it. Done when the `202` answers `opened: true`, the human sees the Incident in the Project's **Incidents** tab of the dashboard, and a second request with the same title, Environment and `resolved: true` answers `state: 'closed'`. Ask the human to confirm both.
