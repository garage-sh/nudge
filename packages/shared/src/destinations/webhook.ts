import { z } from 'zod';
import { schemaUrlHttp, type DefinitionDestination } from './definition.js';

/**
 * Webhook générique : un POST JSON signé HMAC-SHA256 vers l'URL configurée. Le
 * secret de signature est généré par l'Instance (D10) ; l'URL n'est pas un secret,
 * la signature authentifie l'appel.
 */
export const definitionWebhook = {
  config: z.strictObject({ url: schemaUrlHttp }),
  secrets: z.strictObject({}),
  secretsGeneres: ['secretSignature'],
} as const satisfies DefinitionDestination;

export type ConfigWebhook = z.output<typeof definitionWebhook.config>;
export interface SecretsWebhook {
  readonly secretSignature: string;
}
