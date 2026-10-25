import { captureFileName, type CaptureType } from '@nudge/shared';

/** The key of a Capture in the storage: one per Feedback. */
export const captureKey = (feedbackId: string, contentType: CaptureType): string =>
  `feedbacks/${captureFileName(feedbackId, contentType)}`;
