import type {
  FEEDBACK_LIMITS,
  CAPTURE_MAX_BYTES as INSTANCE_CAPTURE_MAX_BYTES,
  CAPTURE_TYPES as INSTANCE_CAPTURE_TYPES,
} from '@nudge/shared';

/**
 * Domain values the Widget needs, copied rather than imported: the build stays
 * dependency-free (no zod in the host page). The compiler keeps them aligned with
 * `@nudge/shared`: a bound changed there breaks the typecheck here. The Feedback types
 * live in the locale dictionaries, which must label every one of them.
 */

/** Ingestion bounds the Widget enforces before sending. */
export const LIMITS = {
  text: 5000,
  email: 320,
  url: 2048,
  userAgent: 1024,
} as const satisfies Pick<typeof FEEDBACK_LIMITS, 'text' | 'email' | 'url' | 'userAgent'>;

/** Capture formats the Instance accepts, and its maximum size (bytes). */
export const CAPTURE_TYPES = [
  'image/png',
  'image/jpeg',
] as const satisfies readonly (typeof INSTANCE_CAPTURE_TYPES)[number][];
export type CaptureType = (typeof CAPTURE_TYPES)[number];
export const CAPTURE_MAX_BYTES = 2_097_152 satisfies typeof INSTANCE_CAPTURE_MAX_BYTES;
