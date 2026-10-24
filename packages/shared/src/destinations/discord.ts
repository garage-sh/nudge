import { z } from 'zod';
import type { DefinitionDestination } from './definition.js';

/** Hôtes d'où Discord délivre une URL de webhook (« Copier l'URL du webhook »). */
const HOTES_DISCORD = ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com'];

/** `/api[/v<n>]/webhooks/<id>/<jeton>` : l'id est un snowflake, le jeton un secret. */
const CHEMIN_WEBHOOK = /^\/api(?:\/v\d+)?\/webhooks\/(\d{1,20})\/([\w-]{1,200})\/?$/;

export interface WebhookDiscord {
  readonly id: string;
  readonly jeton: string;
}

/**
 * L'id et le jeton d'une URL de webhook de salon Discord, ou `null` si l'URL n'en est
 * pas une (https, hôte Discord, sans paramètres : un `thread_id` n'est pas géré).
 */
export function lireWebhookDiscord(valeur: string): WebhookDiscord | null {
  let url: URL;
  try {
    url = new URL(valeur.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!HOTES_DISCORD.includes(url.hostname) || url.search || url.hash) return null;
  const morceaux = CHEMIN_WEBHOOK.exec(url.pathname);
  return morceaux ? { id: morceaux[1]!, jeton: morceaux[2]! } : null;
}

/**
 * Discord : un webhook de salon. Son URL porte le jeton qui autorise à poster : c'est
 * un secret, chiffré en base et jamais rendu. Aucune configuration en clair.
 */
export const definitionDiscord = {
  config: z.strictObject({}),
  secrets: z.strictObject({
    url: z
      .string()
      .trim()
      .refine((valeur) => lireWebhookDiscord(valeur) !== null, {
        message: 'URL de webhook Discord attendue (https://discord.com/api/webhooks/…)',
      }),
  }),
  secretsGeneres: [],
} as const satisfies DefinitionDestination;

export type SecretsDiscord = z.output<typeof definitionDiscord.secrets>;
