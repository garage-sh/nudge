import type { FeedbackState } from '@nudge/shared';
import type { Verdict } from './triage.js';

/**
 * Lifecycle of a Feedback (spec #1):
 *
 *   Received ──▶ Triaged ──┬──▶ Dispatched   (≥ 1 accepting Destination)
 *                          ├──▶ Discarded    (Junk) ─────────── reinstate ──▶ Dispatched
 *                          └──▶ In review    (Manipulation) ─── approve ────▶ Dispatched
 *                                                           └── reject ─────▶ Discarded
 */

/** The state of a Feedback right after its Triage, according to its Verdict. */
export function stateAfterTriage(
  verdict: Verdict,
): Extract<FeedbackState, 'triaged' | 'discarded' | 'in_review'> {
  // Manipulation wins: a human must see the attempt.
  if (verdict.manipulation) return 'in_review';
  if (verdict.junk) return 'discarded';
  return 'triaged';
}

/** Review rule shared with the dashboard (`allowedReviewActions`). */
export { REVIEW_ACTIONS, REVIEW_TRANSITIONS, type ReviewAction } from '@nudge/shared';

export type ReviewResult =
  | { readonly status: 'applied'; readonly state: FeedbackState }
  /** The Feedback is not in the transition's starting state: nothing changed. */
  | { readonly status: 'refused'; readonly state: FeedbackState }
  | { readonly status: 'not_found' };
