import { z } from 'zod';

/**
 * Building blocks of the public API's bodies (Feedback, Incident): the cleaning and
 * bounds every piece of external text goes through.
 */

// C0, DEL and C1 control characters, except tab and line breaks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const stripControlCharacters = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, '');

/** A string stripped of its control characters, then bounded. Nothing else is changed. */
export const boundedString = (max: number) =>
  z.string().transform(stripControlCharacters).pipe(z.string().max(max));

export const nonBlank = (value: string) => value.trim().length > 0;

/** Bounds of a record of scalar values (Feedback metadata, an Incident's context). */
export interface ScalarRecordLimits {
  readonly keys: number;
  readonly key: number;
  readonly value: number;
}

/**
 * A record with non-blank string keys and scalar values (bounded string, finite
 * number, boolean or null), with at most `limits.keys` entries.
 */
export const scalarRecord = (limits: ScalarRecordLimits, entries: string) =>
  z
    .record(
      boundedString(limits.key).refine(nonBlank),
      z.union([boundedString(limits.value), z.number().finite(), z.boolean(), z.null()]),
    )
    .refine((value) => Object.keys(value).length <= limits.keys, {
      message: `${limits.keys} ${entries} at most`,
    });
