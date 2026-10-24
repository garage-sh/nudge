import { z } from 'zod';
import type { DefinitionDestination } from './definition.js';

/**
 * Hôtes d'où Slack délivre l'URL d'un webhook entrant : `hooks.slack.com`, ou
 * `hooks.slack-gov.com` pour GovSlack
 * (https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks).
 */
const HOTES_SLACK = ['hooks.slack.com', 'hooks.slack-gov.com'];

/** `/services/<espace de travail>/<webhook>/<jeton>` : `T00000000/B00000000/XXXX…`. */
const CHEMIN_WEBHOOK = /^\/services\/([A-Z0-9]{1,30})\/([A-Z0-9]{1,30})\/([A-Za-z0-9]{1,100})\/?$/;

/**
 * L'URL canonique d'un webhook entrant Slack, ou `null` si la valeur n'en est pas une
 * (https, hôte Slack, sans paramètres). Les webhooks de Workflow Builder
 * (`/triggers/…`) attendent un autre corps : ils ne sont pas acceptés.
 */
export function lireWebhookSlack(valeur: string): string | null {
  let url: URL;
  try {
    url = new URL(valeur.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!HOTES_SLACK.includes(url.hostname) || url.search || url.hash) return null;
  const morceaux = CHEMIN_WEBHOOK.exec(url.pathname);
  return morceaux ? `https://${url.hostname}/services/${morceaux.slice(1, 4).join('/')}` : null;
}

/**
 * Slack : un webhook entrant, lié à un canal. Son URL porte le jeton qui autorise à
 * poster : c'est un secret, chiffré en base et jamais rendu. Aucune configuration en
 * clair (le canal est fixé par le webhook).
 */
export const definitionSlack = {
  config: z.strictObject({}),
  secrets: z.strictObject({
    url: z
      .string()
      .trim()
      .refine((valeur) => lireWebhookSlack(valeur) !== null, {
        message: 'URL de webhook entrant Slack attendue (https://hooks.slack.com/services/…)',
      }),
  }),
  secretsGeneres: [],
} as const satisfies DefinitionDestination;

export type SecretsSlack = z.output<typeof definitionSlack.secrets>;
