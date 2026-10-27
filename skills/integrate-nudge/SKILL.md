---
name: integrate-nudge
description: Integrate nudge, the self-hosted feedback tool, into an application. Use when adding the nudge Widget to a web app, sending Feedback to a nudge Instance from a server, or wiring the signed-in user, metadata or a Capture into nudge.
---

# Integrate nudge

nudge collects Feedback from an application, triages it and dispatches it. Each application is a **Project** of a self-hosted **Instance**. The application either embeds the **Widget** (a "Send feedback" button, in the browser) or posts Feedback from its server. Both call `POST /v1/feedbacks`.

The contract of that endpoint is the OpenAPI document, the single source of truth for fields, bounds and error codes: <https://github.com/garage-sh/nudge/releases/latest/download/openapi.json>. Fetch it before writing a payload by hand.

## 1. Collect the Instance values

Every value below comes from the human, who reads it in the Instance's dashboard. Ask for the ones you are missing, and stop until you have them: an invented key or URL fails at runtime.

- **Instance URL** — `https://nudge.example.com`, HTTPS.
- **Public key** (`nk_pub_…`) — for the Widget. Public by design: it ships in the page.
- **Secret key** (`nk_sec_…`) — for the server path only. Treat it as a password: an environment variable, read on the server.
- **Allowed origins** — the Project must list every origin the Widget runs on (`https://app.example.com`, plus the local dev origin if the human wants to test locally). A missing origin is a `403 origin_refused`.

Done when you hold the URL and the key the chosen path needs, and the human has confirmed the origins.

## 2. Choose the path

| The application needs…                                            | Path               |
| ----------------------------------------------------------------- | ------------------ |
| A feedback button, no user identity                               | Script tag (A)     |
| A feedback button that knows the signed-in user or app metadata   | Mounted Widget (B) |
| An identity nudge can trust, or Feedback raised by the app itself | Server (C)         |

The identity sent from the browser is **declared**: anyone can forge it. Only the server path, with the secret key, records it as **attested**. When the human cares who wrote a Feedback, take path C.

## 3. Implement

### A. Script tag

In the HTML shell served on every page:

```html
<script
  src="https://nudge.example.com/widget/nudge-widget.js"
  data-public-key="nk_pub_…"
  data-api="https://nudge.example.com"
></script>
```

### B. Mounted Widget

Load the script without the `data-` attributes, then mount the Widget once, from the application's code:

```js
const widget = Nudge.mountWidget({
  publicKey: 'nk_pub_…',
  api: 'https://nudge.example.com',
  author: { id: user.id, email: user.email, name: user.name }, // all optional
  metadata: { version: '2.3.1', plan: 'pro' }, // scalar values, 50 keys at most
  redactUrl: (url) => url.origin + url.pathname, // when URLs carry tokens or personal ids
});
```

In a single-page app, mount once at startup and assign `widget.author` and `widget.metadata` when the session changes; `widget.remove()` unmounts it. In TypeScript, declare the global: `declare const Nudge: { mountWidget(options: object): HTMLElement & { author?: object; metadata?: object } }`.

`redactUrl` receives the full page URL and returns the URL to send, or `null`. The fragment is already dropped by default. Pass `redactUrl` whenever a query string carries a token, a session or a personal id.

### C. Server

If the project depends on `@nudge/sdk`, use its `createClient({ url, secretKey }).sendFeedback(input)`. Otherwise post the JSON yourself:

```ts
const response = await fetch(`${process.env.NUDGE_URL}/v1/feedbacks`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.NUDGE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'I cannot download my invoice',
    author: { id: user.id, email: user.email },
    context: { url: 'https://app.example.com/invoices', metadata: { plan: 'pro' } },
  }),
});
// 202 { id, state: 'received' }; otherwise { error, details? }
```

The secret key stays in server code and server environment variables, out of the client bundle and out of the repository. When the browser is the one asking, expose an endpoint of the application that authenticates its user, then posts to nudge from the server.

## Payload rules

These are the rules agents get wrong; the OpenAPI document has the rest.

- **Strict objects.** An unknown field (`rating`, `page`, `user`, `tags`…) refuses the whole Feedback with `400 invalid_feedback`. Everything specific to the application goes in `context.metadata`.
- **Flat metadata.** Values are strings, numbers, booleans or `null`; nest nothing. 50 keys at most.
- **`type` is a hint.** `bug`, `suggestion`, `opinion` or `question`, as the Author chose it. The Judge resolves the type itself; leave it out rather than guess.
- **`text` is the Author's words**, 5,000 characters at most, never blank.
- **A Capture** is the Widget's job: it lets the Author attach a screenshot, masked in the browser. Mark sensitive elements of the page with `data-nudge-mask` so they are always masked.

## Errors

The body is `{ error, details? }`. Handle `429` (`too_many_feedbacks`, `too_many_attempts`) by honouring `Retry-After`; nothing else is worth retrying. `401` is a wrong key, `403 origin_refused` a missing Allowed origin: both are configuration, for the human to fix in the dashboard.

## 4. Verify

Done when a Feedback sent from the application appears in the Project in the dashboard. For the Widget, load a page from an Allowed origin, open "Send feedback" and send one. For the server path, send one and check the `202`. Ask the human to confirm it arrived.
