import { z } from 'zod';
import { FEEDBACK_TYPES, type FeedbackState } from './domain.js';

/** Ingestion bounds: they protect storage and the Judge. */
export const FEEDBACK_LIMITS = {
  text: 5000,
  authorField: 255,
  email: 320,
  url: 2048,
  userAgent: 1024,
  viewportDimension: 100_000,
  metadataKeys: 50,
  metadataKey: 100,
  metadataValue: 1000,
} as const;

// C0, DEL and C1 control characters, except tab and line breaks.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const stripControlCharacters = (value: string): string =>
  value.replace(CONTROL_CHARACTERS, '');

/** A string stripped of its control characters, then bounded. Nothing else is changed. */
const boundedString = (max: number) =>
  z.string().transform(stripControlCharacters).pipe(z.string().max(max));

const nonBlank = (value: string) => value.trim().length > 0;

const metadataValueSchema = z.union([
  boundedString(FEEDBACK_LIMITS.metadataValue),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const metadata = z
  .record(boundedString(FEEDBACK_LIMITS.metadataKey).refine(nonBlank), metadataValueSchema)
  .refine((value) => Object.keys(value).length <= FEEDBACK_LIMITS.metadataKeys, {
    message: `${FEEDBACK_LIMITS.metadataKeys} metadata entries at most`,
  })
  .describe(
    `What the application knows and the Feedback does not say: plan, release, feature flag… ` +
      `${FEEDBACK_LIMITS.metadataKeys} entries at most, with non-blank keys and scalar values only.`,
  );

const dimension = z.number().int().min(0).max(FEEDBACK_LIMITS.viewportDimension);

export const authorSchema = z
  .strictObject({
    id: boundedString(FEEDBACK_LIMITS.authorField)
      .describe("The user's id in the application.")
      .optional(),
    email: boundedString(FEEDBACK_LIMITS.email)
      .pipe(z.email())
      .describe(`${FEEDBACK_LIMITS.email} characters at most.`)
      .optional(),
    name: boundedString(FEEDBACK_LIMITS.authorField).optional(),
  })
  .describe(
    'The signed-in user. Declared when sent with the public key, attested with the secret key.',
  );

export const contextSchema = z.strictObject({
  url: boundedString(FEEDBACK_LIMITS.url)
    .pipe(z.url())
    .describe(`The page the Feedback is about, ${FEEDBACK_LIMITS.url} characters at most.`)
    .optional(),
  userAgent: boundedString(FEEDBACK_LIMITS.userAgent).optional(),
  viewport: z
    .strictObject({ width: dimension, height: dimension })
    .describe('Size of the browser window, in CSS pixels.')
    .optional(),
  metadata: metadata.optional(),
});

/** Image formats of a Capture: those the Widget produces from a canvas. */
export const CAPTURE_TYPES = ['image/png', 'image/jpeg'] as const;
export type CaptureType = (typeof CAPTURE_TYPES)[number];

/** Maximum size of a decoded Capture: 2 MiB. */
export const CAPTURE_MAX_BYTES = 2_097_152;

/** Signature (first bytes) of each format: the content must be what it claims. */
const CAPTURE_SIGNATURES: Record<CaptureType, readonly number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/** Maximum length of a base64-encoded Capture (4 characters per 3 bytes). */
export const CAPTURE_MAX_BASE64_LENGTH = Math.ceil(CAPTURE_MAX_BYTES / 3) * 4;

const CAPTURE_EXTENSIONS: Record<CaptureType, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' };

/** File name of a Capture, as a Member or a Destination sees it. */
export const captureFileName = (feedbackId: string, contentType: CaptureType): string =>
  `capture-${feedbackId}.${CAPTURE_EXTENSIONS[contentType]}`;

/** Size in bytes of base64-encoded content (with padding). */
const base64Bytes = (data: string): number =>
  (data.length / 4) * 3 - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);

/** The first decoded bytes; `null` if `data` is not base64 (the field already says so). */
function firstBytes(data: string): number[] | null {
  try {
    return Array.from(atob(data.slice(0, 12)), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Capture of the page attached by the Author, already masked and blurred in their browser:
 * a base64-encoded PNG or JPEG image of at most `CAPTURE_MAX_BYTES` bytes.
 */
export const captureInputSchema = z
  .strictObject({
    contentType: z.enum(CAPTURE_TYPES),
    data: z
      .base64()
      .max(CAPTURE_MAX_BASE64_LENGTH)
      .refine((data) => data.length > 0, { message: 'Empty capture' })
      .describe(
        `The image, base64-encoded: ${CAPTURE_MAX_BYTES} bytes at most once decoded, ` +
          'and its first bytes must match `contentType`.',
      ),
  })
  .superRefine(({ contentType, data }, context) => {
    if (base64Bytes(data) > CAPTURE_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: `Capture larger than ${CAPTURE_MAX_BYTES} bytes`,
      });
      return;
    }
    // Zod runs this refinement even when `data` failed its own checks.
    const bytes = firstBytes(data);
    if (!bytes) return;
    if (!CAPTURE_SIGNATURES[contentType].every((byte, index) => bytes[index] === byte)) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: `The content is not a ${contentType} image`,
      });
    }
  });

/** Body of a Feedback posted to the public API (Widget or secret key). */
export const feedbackInputSchema = z
  .strictObject({
    text: boundedString(FEEDBACK_LIMITS.text)
      .refine(nonBlank, { message: 'Empty text' })
      .describe(
        "The Author's words, not blank. Control characters are removed before the length is checked.",
      ),
    type: z
      .enum(FEEDBACK_TYPES)
      .describe('The type the Author chose: a hint, the Judge resolves the type of the Verdict.')
      .optional(),
    author: authorSchema.optional(),
    context: contextSchema.optional(),
    capture: captureInputSchema
      .describe('Screenshot of the page, masked and blurred before it leaves the browser.')
      .optional(),
  })
  .describe('Every object is strict: an unknown field refuses the whole Feedback.');

/** What the caller sends. */
export type FeedbackInput = z.input<typeof feedbackInputSchema>;
/** What the Instance keeps after validation and cleaning. */
export type ValidatedFeedback = z.output<typeof feedbackInputSchema>;
export type Author = z.output<typeof authorSchema>;
export type Context = z.output<typeof contextSchema>;
export type CaptureInput = z.output<typeof captureInputSchema>;

/** Response of the public API (202): the Feedback is stored and awaits its Triage. */
export interface ReceivedFeedback {
  readonly id: string;
  readonly state: Extract<FeedbackState, 'received'>;
}
