import { z } from 'zod';
import type { DestinationDefinition } from './definition.js';

/** Recipients of one email Destination: a team's inbox or a few people, not a mailing list. */
export const EMAIL_RECIPIENTS_MAX = 10;

const recipient = z.string().trim().toLowerCase().pipe(z.email().max(320));

/**
 * Email: a message per Feedback to a few addresses, sent through the Instance's SMTP
 * server (Settings). The addresses are not secret; the SMTP credentials belong to the
 * Instance, not to the Destination.
 */
export const emailDefinition = {
  config: z.strictObject({
    recipients: z
      .array(recipient)
      .min(1, { message: 'Enter at least one email address' })
      .max(EMAIL_RECIPIENTS_MAX, { message: `At most ${EMAIL_RECIPIENTS_MAX} email addresses` })
      .transform((recipients) => [...new Set(recipients)]),
  }),
  secrets: z.strictObject({}),
  generatedSecrets: [],
} as const satisfies DestinationDefinition;

export type EmailConfig = z.output<typeof emailDefinition.config>;
