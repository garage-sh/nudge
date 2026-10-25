import { Inject, Injectable } from '@nestjs/common';
import { DISPATCH_JOB, dispatchJobId, type DispatchJob } from '@nudge/core';
import {
  undoRedispatch,
  redispatchFeedback,
  type Db,
  type RedispatchResult,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/**
 * Manual redispatch of a Triaged or Dispatched Feedback (D22): the only path, with the
 * replay of a Delivery, that propagates a Verdict correction to the Destinations. It
 * creates the missing Deliveries to those whose Filter now accepts the Feedback, without
 * touching the existing Deliveries.
 */
@Injectable()
export class RedispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * The pending Deliveries created leave with their first job (`dispatchJobId`), as in
   * the Dispatch after Triage. If the queueing fails, the redispatch is undone so that
   * the Member can try again.
   */
  async redispatch(feedbackId: string): Promise<RedispatchResult> {
    if (!isUuid(feedbackId)) return { status: 'not_found' };
    const result = await redispatchFeedback(this.db, feedbackId);
    if (result.status !== 'applied') return result;
    const pending = result.deliveries.filter((delivery) => delivery.status === 'pending');
    try {
      await this.dispatchQueue.addBulk(
        pending.map(({ id }) => ({
          name: DISPATCH_JOB,
          data: { deliveryId: id },
          opts: { jobId: dispatchJobId(id) },
        })),
      );
    } catch (error) {
      await undoRedispatch(
        this.db,
        feedbackId,
        pending.map(({ id }) => id),
      );
      throw error;
    }
    return result;
  }
}
