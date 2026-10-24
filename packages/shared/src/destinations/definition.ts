import { z } from 'zod';

/**
 * Ce qu'un type de Destination déclare pour l'API du dashboard. Chaque type
 * (`webhook.ts`, `discord.ts`…) en exporte une, enregistrée dans
 * `DEFINITIONS_DESTINATION` (`index.ts`).
 */
export interface DefinitionDestination {
  /** Configuration non secrète : stockée en clair (jsonb) et rendue au dashboard. */
  readonly config: z.ZodType<Record<string, unknown>>;
  /**
   * Secrets saisis par le Membre (jetons, URL à jeton…) : chiffrés en base, jamais
   * rendus. Un schéma vide (`z.strictObject({})`) si le type n'en a pas.
   */
  readonly secrets: z.ZodType<Record<string, string>>;
  /**
   * Secrets que l'Instance génère elle-même à la création (secret de signature…) :
   * chiffrés avec les autres, montrés une seule fois au Membre, régénérables.
   */
  readonly secretsGeneres: readonly string[];
}

/** URL http(s) d'un service externe, sans identifiants (ils iraient en clair dans la config). */
export const schemaUrlHttp = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (valeur) => {
      try {
        const url = new URL(valeur);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
        );
      } catch {
        return false;
      }
    },
    { message: 'URL http(s) attendue, sans identifiants' },
  );
