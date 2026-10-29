import { z } from 'zod';
import { LEVELS, type IncidentState, type Level } from './domain.js';
import { FEEDBACK_LIMITS } from './feedback-input.js';
import { boundedString, nonBlank, scalarRecord, stripControlCharacters } from './input.js';

/** Ingestion bounds of an Occurrence: the context is bounded like Feedback metadata. */
export const INCIDENT_LIMITS = {
  title: 300,
  message: 5000,
  environment: 100,
  fingerprint: 255,
  contextKeys: FEEDBACK_LIMITS.metadataKeys,
  contextKey: FEEDBACK_LIMITS.metadataKey,
  contextValue: FEEDBACK_LIMITS.metadataValue,
} as const;

/** A short label (Environment, Fingerprint): trimmed, so a stray space opens no other Incident. */
const label = (max: number, description: string) =>
  z
    .string()
    .transform(stripControlCharacters)
    .pipe(z.string().trim().max(max).refine(nonBlank, { message: 'Empty value' }))
    .describe(description);

const incidentContextSchema = scalarRecord(
  {
    keys: INCIDENT_LIMITS.contextKeys,
    key: INCIDENT_LIMITS.contextKey,
    value: INCIDENT_LIMITS.contextValue,
  },
  'context entries',
).describe(
  'What whoever reads the Incident needs to act: version, host, service, trace link… ' +
    `${INCIDENT_LIMITS.contextKeys} entries at most, with non-blank keys and scalar values ` +
    `(strings of ${INCIDENT_LIMITS.contextValue} characters at most). It never decides the ` +
    'Fingerprint. Never put secrets or personal data in it.',
);

/** Body of an Occurrence posted to the public API, with the Project's secret key. */
export const incidentInputSchema = z
  .strictObject({
    title: boundedString(INCIDENT_LIMITS.title)
      .refine(nonBlank, { message: 'Empty title' })
      .describe(
        'What is going wrong, not blank. Without a Fingerprint, Occurrences with the same ' +
          'title and Environment are grouped into one Incident.',
      ),
    message: boundedString(INCIDENT_LIMITS.message)
      .describe('The detail of what went wrong.')
      .optional(),
    level: z
      .enum(LEVELS)
      .describe(
        'How serious it is. Without it, the Project’s default Level applies. A higher Level ' +
          'on a later Occurrence raises the Incident’s Level.',
      )
      .optional(),
    environment: label(
      INCIDENT_LIMITS.environment,
      'Where the application runs (production, staging…), as you name it.',
    ).optional(),
    fingerprint: label(
      INCIDENT_LIMITS.fingerprint,
      'Groups the Occurrences that share it into one Open Incident, whatever their titles ' +
        '(for a title carrying a variable id). Derived from the title and the Environment ' +
        'when absent.',
    ).optional(),
    context: incidentContextSchema.optional(),
  })
  .describe('One request is one Occurrence. Strict: an unknown field refuses the Occurrence.');

/** What the caller sends. */
export type IncidentInput = z.input<typeof incidentInputSchema>;
/** What the Instance keeps after validation and cleaning. */
export type ValidatedIncident = z.output<typeof incidentInputSchema>;
export type IncidentContext = z.output<typeof incidentContextSchema>;

/**
 * An Occurrence as the Incident keeps it (its first and its last): what was sent, with
 * `null` for what was not, and when it was received (ISO 8601).
 */
export interface IncidentReport {
  readonly title: string;
  readonly message: string | null;
  /** The declared Level, `null` when the sender declared none. */
  readonly level: Level | null;
  readonly environment: string | null;
  /** The declared Fingerprint, `null` when nudge derived it. */
  readonly fingerprint: string | null;
  readonly context: IncidentContext;
  readonly receivedAt: string;
}

/** Response of the public API (202): the Incident the Occurrence landed in. */
export interface ReceivedIncident {
  readonly id: string;
  readonly state: IncidentState;
  /** `true` when this Occurrence opened the Incident, `false` when it was absorbed. */
  readonly opened: boolean;
}
