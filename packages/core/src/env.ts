/**
 * Reading the apps' environment variables (`main.ts`). An invalid value throws, naming
 * the variable, so that the Instance refuses to start rather than run with a
 * configuration the Self-hoster did not intend. An empty variable counts as an absent
 * one (`VAR=` in a `.env` or a docker-compose).
 */
export type Env = Readonly<Record<string, string | undefined>>;

const read = (env: Env, name: string): string | undefined => env[name]?.trim() || undefined;

export function requireEnv(env: Env, name: string): string {
  const value = read(env, name);
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function optionalEnv(env: Env, name: string): string | null {
  return read(env, name) ?? null;
}

interface Bounds {
  readonly min: number;
  readonly max?: number;
}

const outOfBounds = (value: number, { min, max }: Bounds) =>
  value < min || (max !== undefined && value > max);

const expected = ({ min, max }: Bounds) =>
  max === undefined ? `at least ${min}` : `between ${min} and ${max}`;

/** An integer, `fallback` if the variable is absent. */
export function integerEnv(env: Env, name: string, fallback: number, bounds: Bounds): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || outOfBounds(value, bounds)) {
    throw new Error(`Invalid ${name}: "${raw}" (expected an integer ${expected(bounds)})`);
  }
  return value;
}

/** A decimal number (`0.75`), `fallback` if the variable is absent. */
export function numberEnv(env: Env, name: string, fallback: number, bounds: Bounds): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const value = /^-?(\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : NaN;
  if (Number.isNaN(value) || outOfBounds(value, bounds)) {
    throw new Error(`Invalid ${name}: "${raw}" (expected a number ${expected(bounds)})`);
  }
  return value;
}

/** `true` or `false`, `fallback` if the variable is absent. */
export function booleanEnv(env: Env, name: string, fallback: boolean): boolean {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Invalid ${name}: "${raw}" (expected true or false)`);
}

/** An absolute http(s) URL, `null` if the variable is absent. */
export function httpUrlEnv(env: Env, name: string): string | null {
  const raw = read(env, name);
  if (raw === undefined) return null;
  if (!/^https?:\/\/[^/]/.test(raw) || !URL.canParse(raw)) {
    throw new Error(`Invalid ${name}: "${raw}" (expected an http(s) URL)`);
  }
  return raw;
}
