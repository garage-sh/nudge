import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { test as base, type Page, type Route } from '@playwright/test';

/** The app of a Project that embeds the Widget, and the nudge Instance that serves it. */
export const HOST_ORIGIN = 'https://app.example';
export const CDN = 'https://cdn.example';
export const API = 'https://nudge.example';
export const PUBLIC_KEY = 'nk_pub_test';

const DIST = join(import.meta.dirname, '..', 'dist');

/** What the fake API received on `POST /v1/feedbacks`. */
export interface ReceivedRequest {
  readonly authorization: string | null;
  readonly origin: string | null;
  readonly body: unknown;
}

type Response = (route: Route) => Promise<void>;

const CORS = (origin: string | undefined) => ({
  'access-control-allow-origin': origin ?? '*',
  vary: 'Origin',
});

/**
 * Fake public API of the Instance: it records the posted Feedback and answers 202 by
 * default, or what it was told to (status, network cut), once each.
 */
export class FakeApi {
  readonly requests: ReceivedRequest[] = [];
  private readonly upcoming: Response[] = [];

  /** The next request gets this status, body and headers. */
  respond(status: number, body: unknown, headers: Record<string, string> = {}): void {
    this.upcoming.push((route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        headers: { ...CORS(route.request().headers().origin), ...headers },
        body: JSON.stringify(body),
      }),
    );
  }

  /** The next request never reaches the Instance (network down). */
  cutNetwork(): void {
    this.upcoming.push((route) => route.abort('internetdisconnected'));
  }

  async serve(route: Route): Promise<void> {
    const request = route.request();
    const headers = request.headers();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          ...CORS(headers.origin),
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': 'Authorization, Content-Type',
        },
      });
      return;
    }
    this.requests.push({
      authorization: headers.authorization ?? null,
      origin: headers.origin ?? null,
      body: request.postDataJSON(),
    });
    const response = this.upcoming.shift();
    if (response) return response(route);
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      headers: CORS(headers.origin),
      body: JSON.stringify({ id: crypto.randomUUID(), state: 'received' }),
    });
  }
}

export interface HostPage {
  /** Path of the page on the host origin. */
  readonly path?: string;
  /** The page's `<html lang>` (`en` by default); `null` leaves it out. */
  readonly lang?: string | null;
  /** Content of `<head>` (the app's styles…). */
  readonly head?: string;
  /** Content of `<body>`, before the Widget integration. */
  readonly body?: string;
  /**
   * Widget integration; by default, the IIFE build's script tag with the public key
   * and the Instance address as `data-` attributes.
   */
  readonly integration?: string;
}

export const SCRIPT_TAG = `<script src="${CDN}/nudge-widget.js" data-public-key="${PUBLIC_KEY}" data-api="${API}"></script>`;

/** The host app: a page served on its origin, the Widget builds on the CDN. */
export class Host {
  constructor(private readonly page: Page) {}

  async open(options: HostPage = {}): Promise<void> {
    const path = options.path ?? '/';
    const lang = options.lang === undefined ? 'en' : options.lang;
    const html = `<!doctype html>
<html${lang === null ? '' : ` lang="${lang}"`}>
  <head><meta charset="utf-8"><title>Host app</title>${options.head ?? ''}</head>
  <body>${options.body ?? ''}${options.integration ?? SCRIPT_TAG}</body>
</html>`;
    await this.page.route(`${HOST_ORIGIN}/**`, (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
    );
    await this.page.goto(`${HOST_ORIGIN}${path}`);
  }
}

async function serveDist(route: Route): Promise<void> {
  const file = normalize(new URL(route.request().url()).pathname).replace(/^\/+/, '');
  try {
    const content = await readFile(join(DIST, file));
    await route.fulfill({
      contentType: 'text/javascript; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: content,
    });
  } catch {
    await route.fulfill({ status: 404, body: 'not_found' });
  }
}

export const test = base.extend<{ api: FakeApi; host: Host }>({
  api: async ({ page }, use) => {
    const api = new FakeApi();
    await page.route(`${API}/**`, (route) => api.serve(route));
    await use(api);
  },
  host: async ({ page, api: _api }, use) => {
    await page.route(`${CDN}/**`, serveDist);
    await use(new Host(page));
  },
});

export { expect } from '@playwright/test';
