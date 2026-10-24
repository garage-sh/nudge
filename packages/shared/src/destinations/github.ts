import { z } from 'zod';
import type { DefinitionDestination } from './definition.js';

/**
 * `propriétaire/dépôt` : un compte GitHub (lettres, chiffres, tirets, 39 caractères au
 * plus, sans tiret en tête) et un nom de dépôt (lettres, chiffres, `.`, `-`, `_`).
 */
const DEPOT = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/;

export interface DepotGitHub {
  readonly proprietaire: string;
  readonly nom: string;
}

/** Le propriétaire et le nom d'un dépôt `propriétaire/dépôt`, ou `null`. */
export function lireDepotGitHub(valeur: string): DepotGitHub | null {
  const morceaux = DEPOT.exec(valeur.trim());
  if (!morceaux) return null;
  const nom = morceaux[2]!;
  if (nom === '.' || nom === '..' || nom.endsWith('.git')) return null;
  return { proprietaire: morceaux[1]!, nom };
}

/**
 * GitHub Issues : une issue créée dans le dépôt configuré, par l'API REST avec un jeton
 * d'accès personnel (secret, chiffré en base, jamais rendu). Un jeton « fine-grained »
 * limité au dépôt suffit, avec la permission « Issues : lecture et écriture ».
 */
export const definitionGitHub = {
  config: z.strictObject({
    depot: z
      .string()
      .trim()
      .refine((valeur) => lireDepotGitHub(valeur) !== null, {
        message: 'Dépôt GitHub attendu sous la forme propriétaire/dépôt',
      }),
  }),
  secrets: z.strictObject({
    jeton: z.string().trim().min(1, { message: 'Jeton d’accès GitHub attendu' }),
  }),
  secretsGeneres: [],
} as const satisfies DefinitionDestination;

export type ConfigGitHub = z.output<typeof definitionGitHub.config>;
export type SecretsGitHub = z.output<typeof definitionGitHub.secrets>;
