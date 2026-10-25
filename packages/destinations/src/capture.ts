import type { CaptureToDispatch, FailureClass } from '@nudge/core';
import type { CaptureType } from '@nudge/shared';
import { errorMessage } from './http.js';

/** A Capture's image, read from storage, ready to attach. */
export interface CaptureImage {
  readonly contentType: CaptureType;
  readonly bytes: Uint8Array;
}

export type LoadedCapture =
  | { readonly ok: true; readonly image: CaptureImage | null }
  | { readonly ok: false; readonly failureClass: FailureClass; readonly message: string };

/**
 * The image of a Feedback's Capture, for an adapter that attaches it. Without a
 * Capture, or if storage no longer has it, `image` is `null`: the Feedback goes out
 * without it. Unreachable storage is a transient failure: the Delivery will be retried.
 */
export async function readCapture(capture: CaptureToDispatch | null): Promise<LoadedCapture> {
  if (!capture) return { ok: true, image: null };
  try {
    const bytes = await capture.read();
    return { ok: true, image: bytes ? { contentType: capture.contentType, bytes } : null };
  } catch (error) {
    return {
      ok: false,
      failureClass: 'transient',
      message: `Unreadable Capture: ${errorMessage(error)}`,
    };
  }
}
