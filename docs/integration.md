# Integrating a Project

How an application sends Feedback to nudge. Create the Project in the dashboard first: it gives you the public key (`nk_pub_…`, for the Widget) and the secret key (`nk_sec_…`, for your server), and its **Allowed origins** list the sites where the Widget is installed.

| Path                                     | Use it when                                                    | Author is    |
| ---------------------------------------- | -------------------------------------------------------------- | ------------ |
| [Coding agent](#with-a-coding-agent)     | you want an agent to choose and wire the right path for you    | —            |
| [Widget: script tag](#widget-script-tag) | any web page; a button and a form, no build step               | **declared** |
| [Widget: React](#widget-react-component) | a React application                                            | **declared** |
| [JS SDK](#js-sdk-from-a-server)          | your server sends Feedback, with an identity you can vouch for | **attested** |
| [HTTP API](#http-api)                    | another language, or no SDK                                    | depends      |

Where the Feedback goes next is set by the Project's Destinations; a webhook Destination is described in [Webhooks](webhooks.md).

## With a coding agent

The `integrate-nudge` skill teaches a coding agent (Claude Code, Cursor, Codex…) to integrate nudge into your application: which path to take, the payload rules, and the values it must ask you for. Install it in the application's repository:

```sh
npx skills add garage-sh/nudge --skill integrate-nudge
```

Then ask your agent to integrate nudge, and give it the Instance URL and the Project's key from the dashboard. The skill lives in [`skills/integrate-nudge`](../skills/integrate-nudge/SKILL.md).

## Widget: script tag

```html
<script
  src="https://nudge.example.com/widget/nudge-widget.js"
  data-public-key="nk_pub_…"
  data-api="https://nudge.example.com"
></script>
```

The Widget adds a "Send feedback" button to the page, which opens a form. It is isolated in a Shadow DOM: its CSS and the page's do not interfere. It is only accepted from the Project's **Allowed origins**. It automatically attaches the page URL (without its `#fragment`, see [Page URL](#page-url)), the browser, the OS and the screen size.

### Language

The Widget speaks English and French. Without a `locale`, it follows the page's `<html lang>`, then the browser's language: French if either is French, English otherwise. To force it, add `data-locale="en"` or `data-locale="fr"` to the script tag (or the `locale` option below).

### Identity and metadata

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

An identity coming from the browser is recorded as **declared**, never as attested: anyone can forge it. For a trustworthy identity, send the Feedback from your server with the [SDK](#js-sdk-from-a-server).

### Page URL

By default, the Widget sends the page URL without its fragment (`#…`), where tokens often travel (OAuth implicit flow, magic links). If the URL carries other sensitive data, such as a token or a personal ID in the query string, pass `redactUrl`. It receives the full page URL as a `URL` (fragment included) and returns the URL to send (a `URL` or a string), or `null` to send none. For example, to drop a query parameter:

```js
redactUrl: (url) => {
  url.searchParams.delete('token');
  return url;
},
```

If `redactUrl` throws or returns something other than an absolute URL, the Feedback is sent without a URL rather than with the unredacted one.

### Captures

The Author can tick "Attach a screenshot of the page". They then see a preview, on which they can blur areas before sending, and nothing is captured without their consent. Mark sensitive elements with `data-nudge-mask`: they are always masked, in the browser, before the image leaves the page. This covers open Shadow DOMs and same-origin iframes too. An iframe whose content the page cannot read (another site, a sandbox) is always masked whole.

```html
<div data-nudge-mask>IBAN: FR76 …</div>
```

## Widget: React component

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

## JS SDK: from a server

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

## HTTP API

The Widget and the SDK both call `POST /v1/feedbacks`, with the `Authorization: Bearer <key>` header. The public key is the Widget's and requires the `Origin` header; the secret key is the server's. The API answers `202 { id, state: 'received' }`, or `{ error, details? }` on refusal; on `429`, wait for `Retry-After`.

The fields, their bounds and the error codes are described in [`docs/api/openapi.json`](api/openapi.json) (OpenAPI 3.1, also attached to every release). It is generated from the schema the api validates with, and a test fails when the two diverge. Every object is strict: an unknown field refuses the whole Feedback, and whatever is specific to your application goes in `context.metadata`, as flat scalar values.
