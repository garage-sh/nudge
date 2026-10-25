import { Inject, Injectable } from '@nestjs/common';
import {
  reviewJobId,
  TRIAGE_JOB,
  type ReviewAction,
  type ReviewResult,
  type TriageJob,
} from '@nudge/core';
import { undoReview, reviewFeedback, type Db } from '@nudge/database';
import type { Queue } from 'bullmq';
import { DB, TRIAGE_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/**
 * Review transitions of a Feedback, triggered by a Member: approve or reject a Feedback
 * In review, reinstate a Feedback Discarded as Junk.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
  ) {}

  /** Approving or reinstating makes the Feedback Triaged, then Dispatched if a Filter accepts it. */
  async review(feedbackId: string, action: ReviewAction): Promise<ReviewResult> {
    if (!isUuid(feedbackId)) return { status: 'not_found' };
    const result = await reviewFeedback(this.db, feedbackId, action);
    if (result.status === 'applied' && result.state === 'triaged') {
      await this.dispatch(feedbackId, action);
    }
    return result;
  }

  /**
   * The triage job dispatches a Triaged Feedback. A Feedback becomes Triaged again only
   * once: a review-specific jobId is enough not to enqueue it twice. If the queueing
   * fails, the transition is undone so that the Member can try again rather than leave
   * a Triaged Feedback that nothing will dispatch.
   */
  private async dispatch(feedbackId: string, action: ReviewAction): Promise<void> {
    try {
      await this.triageQueue.add(TRIAGE_JOB, { feedbackId }, { jobId: reviewJobId(feedbackId) });
    } catch (error) {
      await undoReview(this.db, feedbackId, action);
      throw error;
    }
  }
}
