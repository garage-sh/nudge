import { REVIEW_TRANSITIONS, type ReviewAction, type ReviewResult } from '@nudge/core';
import type { VerdictCorrection } from '@nudge/shared';
import { and, eq, exists } from 'drizzle-orm';
import type { Db } from './client.js';
import { feedbacks, verdicts } from './schema.js';

/**
 * Applies a review transition, conditional on the current state: two Members acting at
 * the same time move the Feedback only once. Does not trigger Dispatch: it is up to the
 * caller to queue again a Feedback made Triaged.
 */
export async function reviewFeedback(
  db: Db,
  feedbackId: string,
  action: ReviewAction,
): Promise<ReviewResult> {
  const { from, to, requiresNoManipulation } = REVIEW_TRANSITIONS[action];
  const conditions = [eq(feedbacks.id, feedbackId), eq(feedbacks.state, from)];
  if (requiresNoManipulation) {
    // Discarded as Junk only: a Feedback suspected of Manipulation was rejected.
    conditions.push(
      exists(
        db
          .select({ id: verdicts.id })
          .from(verdicts)
          .where(and(eq(verdicts.feedbackId, feedbacks.id), eq(verdicts.manipulation, false))),
      ),
    );
  }
  const [applied] = await db
    .update(feedbacks)
    .set({ state: to })
    .where(and(...conditions))
    .returning({ state: feedbacks.state });
  if (applied) return { status: 'applied', state: applied.state };

  const [current] = await db
    .select({ state: feedbacks.state })
    .from(feedbacks)
    .where(eq(feedbacks.id, feedbackId));
  return current ? { status: 'refused', state: current.state } : { status: 'not_found' };
}

/**
 * Undoes a review transition as long as nothing followed it (the Feedback is still in
 * its resulting state): used when the expected effect, queueing, failed.
 */
export async function undoReview(db: Db, feedbackId: string, action: ReviewAction): Promise<void> {
  const { from, to } = REVIEW_TRANSITIONS[action];
  await db
    .update(feedbacks)
    .set({ state: from })
    .where(and(eq(feedbacks.id, feedbackId), eq(feedbacks.state, to)));
}

/**
 * Corrects the resolved type and / or the Severity of a Feedback's Verdict. Checked by a
 * Member, the Verdict is no longer Uncertain; the Judge's raw answers stay as they are.
 * Nothing is queued again: only replaying a Delivery and redispatching the Feedback (D22)
 * propagate the correction.
 * Returns false if the Feedback has no Verdict (yet).
 */
export async function correctVerdict(
  db: Db,
  feedbackId: string,
  correction: VerdictCorrection,
): Promise<boolean> {
  const corrected = await db
    .update(verdicts)
    .set({ ...correction, uncertain: false })
    .where(eq(verdicts.feedbackId, feedbackId))
    .returning({ id: verdicts.id });
  return corrected.length > 0;
}
