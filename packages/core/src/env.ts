/**
 * Lecture des variables d'environnement des apps (`main.ts`). Une valeur invalide lève
 * en nommant la variable, pour que l'Instance refuse de démarrer plutôt que de tourner
 * avec une configuration que le Self-hoster n'a pas voulue. Une variable vide vaut
 * une variable absente (`VAR=` dans un `.env` ou un docker-compose).
 */
export type Env = Readonly<Record<string, string | undefined>>;

const lire = (env: Env, nom: string): string | undefined => env[nom]?.trim() || undefined;

export function requireEnv(env: Env, nom: string): string {
  const valeur = lire(env, nom);
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

export function optionalEnv(env: Env, nom: string): string | null {
  return lire(env, nom) ?? null;
}

interface Bornes {
  readonly min: number;
  readonly max?: number;
}

const horsBornes = (valeur: number, { min, max }: Bornes) =>
  valeur < min || (max !== undefined && valeur > max);

const attendu = ({ min, max }: Bornes) =>
  max === undefined ? `${min} au moins` : `entre ${min} et ${max}`;

/** Un entier, `defaut` si la variable est absente. */
export function integerEnv(env: Env, nom: string, defaut: number, bornes: Bornes): number {
  const brute = lire(env, nom);
  if (brute === undefined) return defaut;
  const valeur = /^-?\d+$/.test(brute) ? Number(brute) : NaN;
  if (!Number.isSafeInteger(valeur) || horsBornes(valeur, bornes)) {
    throw new Error(`${nom} invalide : « ${brute} » (entier ${attendu(bornes)} attendu)`);
  }
  return valeur;
}

/** Un nombre décimal (`0.75`), `defaut` si la variable est absente. */
export function numberEnv(env: Env, nom: string, defaut: number, bornes: Bornes): number {
  const brute = lire(env, nom);
  if (brute === undefined) return defaut;
  const valeur = /^-?(\d+\.?\d*|\.\d+)$/.test(brute) ? Number(brute) : NaN;
  if (Number.isNaN(valeur) || horsBornes(valeur, bornes)) {
    throw new Error(`${nom} invalide : « ${brute} » (nombre ${attendu(bornes)} attendu)`);
  }
  return valeur;
}

/** `true` ou `false`, `defaut` si la variable est absente. */
export function booleanEnv(env: Env, nom: string, defaut: boolean): boolean {
  const brute = lire(env, nom);
  if (brute === undefined) return defaut;
  if (brute === 'true') return true;
  if (brute === 'false') return false;
  throw new Error(`${nom} invalide : « ${brute} » (true ou false attendu)`);
}

/** Une URL http(s) absolue, `null` si la variable est absente. */
export function httpUrlEnv(env: Env, nom: string): string | null {
  const brute = lire(env, nom);
  if (brute === undefined) return null;
  if (!/^https?:\/\/[^/]/.test(brute) || !URL.canParse(brute)) {
    throw new Error(`${nom} invalide : « ${brute} » (URL http(s) attendue)`);
  }
  return brute;
}
