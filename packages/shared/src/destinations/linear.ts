import { z } from 'zod';
import { SEVERITIES, FEEDBACK_TYPES } from '../domain.js';
import type { DestinationDefinition } from './definition.js';

/** Maximum length of an entered label name. */
const LABEL_NAME_MAX = 80;

/**
 * The Linear label applied for a Type or a Severity, by its name as displayed in
 * Linear (case-insensitive). Field left empty: no label.
 */
const labelName = z.string().trim().min(1).max(LABEL_NAME_MAX);

/**
 * Linear: an issue created in the configured team, through the GraphQL API with a
 * personal API key (secret, encrypted in the database, never returned).
 *
 * The team is designated by its key ("ENG" in ENG-123) and labels by their name: the
 * adapter looks them up in Linear. An unknown label, or a team out of the key's reach,
 * refuses the whole Destination.
 */
export const linearDefinition = {
  config: z.strictObject({
    team: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{1,20}$/, {
        message: 'Expected a Linear team key (the letters before the number: ENG in ENG-123)',
      })
      .transform((key) => key.toUpperCase()),
    labels: z
      .strictObject({
        types: z.partialRecord(z.enum(FEEDBACK_TYPES), labelName).default({}),
        severities: z.partialRecord(z.enum(SEVERITIES), labelName).default({}),
      })
      .default({ types: {}, severities: {} }),
  }),
  secrets: z.strictObject({
    apiKey: z.string().trim().min(1, { message: 'Expected a Linear API key' }),
  }),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type LinearConfig = z.output<typeof linearDefinition.config>;
export type LinearSecrets = z.output<typeof linearDefinition.secrets>;
