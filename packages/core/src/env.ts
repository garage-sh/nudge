/**
 * Lecture des variables d'environnement des apps (`main.ts`). Une value invalide lève
 * en nommant la variable, pour que l'Instance refuse de démarrer plutôt que de tourner
 * avec une configuration que le Self-hoster n'a pas voulue. Une variable vide vaut
 * une variable absente (`VAR=` dans un `.env` ou un docker-compose).
 */
export type Env = Readonly<Record<string, string | undefined>>;

const read = (env: Env, name: string): string | undefined => env[name]?.trim() || undefined;

export function requireEnv(env: Env, name: string): string {
  const value = read(env, name);
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
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
  max === undefined ? `${min} au moins` : `entre ${min} et ${max}`;

/** Un entier, `fallback` si la variable est absente. */
export function integerEnv(env: Env, name: string, fallback: number, bounds: Bounds): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || outOfBounds(value, bounds)) {
    throw new Error(`${name} invalide : « ${raw} » (entier ${expected(bounds)} attendu)`);
  }
  return value;
}

/** Un nombre décimal (`0.75`), `fallback` si la variable est absente. */
export function numberEnv(env: Env, name: string, fallback: number, bounds: Bounds): number {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  const value = /^-?(\d+\.?\d*|\.\d+)$/.test(raw) ? Number(raw) : NaN;
  if (Number.isNaN(value) || outOfBounds(value, bounds)) {
    throw new Error(`${name} invalide : « ${raw} » (nombre ${expected(bounds)} attendu)`);
  }
  return value;
}

/** `true` ou `false`, `fallback` si la variable est absente. */
export function booleanEnv(env: Env, name: string, fallback: boolean): boolean {
  const raw = read(env, name);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} invalide : « ${raw} » (true ou false attendu)`);
}

/** Une URL http(s) absolue, `null` si la variable est absente. */
export function httpUrlEnv(env: Env, name: string): string | null {
  const raw = read(env, name);
  if (raw === undefined) return null;
  if (!/^https?:\/\/[^/]/.test(raw) || !URL.canParse(raw)) {
    throw new Error(`${name} invalide : « ${raw} » (URL http(s) attendue)`);
  }
  return raw;
}
