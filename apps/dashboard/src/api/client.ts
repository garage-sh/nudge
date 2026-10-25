import type { ApiErrorBody } from '@nudge/shared';

/** An error returned by the dashboard API: HTTP status and stable code (`session_required`…). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(`${status} ${body.error}`);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body.error;
  }
}

/** A 401 from the API: the session is missing, expired or revoked. */
export const isSessionLost = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A call to the dashboard API (`/api/…`, same origin: the httpOnly session cookie goes
 * along by itself). Returns the JSON body, or throws an `ApiError`.
 */
export async function apiFetch<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      // Required by the api on every write (CSRF defense); sent everywhere for simplicity.
      'x-nudge-client': 'dashboard',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const code = (json as Partial<ApiErrorBody> | null)?.error;
    throw new ApiError(response.status, {
      ...(json as object),
      error: typeof code === 'string' ? code : 'unknown_error',
    });
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>('GET', path),
  post: <T>(path: string, body?: unknown) => apiFetch<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => apiFetch<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>('PATCH', path, body),
  delete: <T>(path: string) => apiFetch<T>('DELETE', path),
};
