/** Response of the dashboard API: status and JSON body (or `null` without a body). */
export interface DashboardResponse<T> {
  readonly status: number;
  readonly body: T;
}

/** Binary response (a Capture's image): status, headers and bytes. */
export interface DashboardDownload {
  readonly status: number;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
  /** The body read as JSON (error response). */
  json<T>(): T;
}

const SESSION_COOKIE = 'nudge_session';

/**
 * HTTP client of the dashboard API, like a Member's browser: it keeps the
 * session cookie set by the api and sends it back on every call.
 */
export class DashboardClient {
  private session: string | null = null;

  constructor(private readonly baseUrl: string) {}

  /** The current session cookie (to check that it is revoked). */
  get sessionCookie(): string | null {
    return this.session;
  }

  /** Replays a session cookie as is (stolen session, revoked session…). */
  withSessionCookie(value: string | null): this {
    this.session = value;
    return this;
  }

  get<T = unknown>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body);
  }

  put<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, body);
  }

  patch<T = unknown>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }

  delete<T = unknown>(path: string) {
    return this.request<T>('DELETE', path);
  }

  /** GET of a binary resource, as an `<img>` tag of the dashboard loads it. */
  async download(path: string): Promise<DashboardDownload> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.session ? { cookie: `${SESSION_COOKIE}=${this.session}` } : {},
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      bytes,
      json: <T>() => JSON.parse(new TextDecoder().decode(bytes)) as T,
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<DashboardResponse<T>> {
    // The dashboard tags each of its requests: the api refuses a write without this header.
    const headers: Record<string, string> = { 'x-nudge-client': 'dashboard' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.session) headers.cookie = `${SESSION_COOKIE}=${this.session}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.retainSession(response.headers.getSetCookie());
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }

  private retainSession(setCookies: string[]): void {
    for (const line of setCookies) {
      const [pair = ''] = line.split(';');
      const separator = pair.indexOf('=');
      if (pair.slice(0, separator).trim() !== SESSION_COOKIE) continue;
      const value = decodeURIComponent(pair.slice(separator + 1).trim());
      const expired = /max-age=0\b/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line);
      this.session = value && !expired ? value : null;
    }
  }
}
