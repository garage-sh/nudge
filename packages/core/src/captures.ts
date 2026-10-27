import { captureFileName, type CaptureType } from '@nudge/shared';

/**
 * Prefix of every Capture key in the storage: the sweep of orphaned Captures only looks
 * there, never at what else shares the bucket or the volume.
 */
export const CAPTURE_KEY_PREFIX = 'feedbacks/';

/** The key of a Capture in the storage: one per Feedback. */
export const captureKey = (feedbackId: string, contentType: CaptureType): string =>
  `${CAPTURE_KEY_PREFIX}${captureFileName(feedbackId, contentType)}`;
