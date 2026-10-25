import { z } from 'zod';

/**
 * What a Destination type declares for the dashboard API. Each type
 * (`webhook.ts`, `discord.ts`…) exports one, registered in
 * `DESTINATION_DEFINITIONS` (`index.ts`).
 */
export interface DestinationDefinition {
  /** Non-secret configuration: stored in clear (jsonb) and returned to the dashboard. */
  readonly config: z.ZodType<Record<string, unknown>>;
  /**
   * Secrets entered by the Member (tokens, URL with a token…): encrypted in the
   * database, never returned. An empty schema (`z.strictObject({})`) if the type has none.
   */
  readonly secrets: z.ZodType<Record<string, string>>;
  /**
   * Secrets the Instance generates itself on creation (signing secret…): encrypted
   * with the others, shown only once to the Member, regenerable.
   */
  readonly generatedSecrets: readonly string[];
}

/** http(s) URL of an external service, without credentials (they would sit in clear in the config). */
export const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
        );
      } catch {
        return false;
      }
    },
    { message: 'Expected an http(s) URL, without credentials' },
  );
