import { vi } from 'vitest';

/** A scripted response: status and JSON body, or a function of the received body. */
export type FakeResponse =
  { status: number; body?: unknown } | ((body: unknown) => { status: number; body?: unknown });

/**
 * A fake dashboard API, plugged in at the network boundary (`fetch`): each
 * `"METHOD /path"` route returns its scripted response; any other, 404.
 * Like the api, it refuses (403) a write without the `x-nudge-client` header.
 * `calls` keeps the received requests, to check what the screen sent.
 */
export function fakeApi(routes: Record<string, FakeResponse>) {
  const calls: { route: string; body: unknown }[] = [];
  const table = { ...routes };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const route = `${method} ${input}`;
      const header = new Headers(init.headers).get('x-nudge-client');
      if (method !== 'GET' && header !== 'dashboard') {
        // Like the api: a write without the dashboard's header is refused.
        return new Response(JSON.stringify({ error: 'missing_header' }), { status: 403 });
      }
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ route, body });
      const scripted = table[route];
      const response =
        typeof scripted === 'function'
          ? scripted(body)
          : (scripted ?? { status: 404, body: { error: 'unknown_route' } });
      return new Response(response.body === undefined ? null : JSON.stringify(response.body), {
        status: response.status,
      });
    }),
  );
  return {
    calls,
    /** Replaces a route's response during a test. */
    set(route: string, response: FakeResponse) {
      table[route] = response;
    },
  };
}

export const MEMBER = { id: 'member-1', email: 'ada@nudge.test' };

export const NO_SESSION = { status: 401, body: { error: 'session_required' } };
export const SIGNED_IN = { status: 200, body: { member: MEMBER } };
