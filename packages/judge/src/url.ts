/** Options shared by the Judge's HTTP adapters. */
export interface AdapterOptions {
  /** Requested model; the adapter's default otherwise. */
  readonly model?: string | null;
  /** Provider host (and optional path prefix); the default one otherwise. */
  readonly baseUrl?: string | null;
  /** Injected by tests; `globalThis.fetch` otherwise. */
  readonly fetch?: typeof globalThis.fetch;
}

/** `https://host/prefix/` + `/v1/x` → `https://host/prefix/v1/x`. */
export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;
