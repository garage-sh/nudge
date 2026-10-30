import { Inject, Injectable } from '@nestjs/common';
import { DISPATCH_JOB, dispatchJobId, type DispatchJob } from '@nudge/core';
import {
  redispatchFeedback,
  redispatchIncident,
  undoIncidentRedispatch,
  undoRedispatch,
  type CreatedDelivery,
  type Db,
  type IncidentRedispatchResult,
  type RedispatchResult,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';

/**
 * Manual Redispatch of a Triaged or Dispatched Feedback (D22), or of an Open Incident:
 * the only path, with the replay of a Delivery, that propagates a Verdict correction or a
 * Filter change to the Destinations. It creates the missing Deliveries to those whose
 * Filter now accepts the subject, without touching the existing Deliveries.
 */
@Injectable()
export class RedispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /** If the queueing fails, the Redispatch is undone so that the Member can try again. */
  async redispatch(feedbackId: string): Promise<RedispatchResult> {
    if (!isUuid(feedbackId)) return { status: 'not_found' };
    const result = await redispatchFeedback(this.db, feedbackId);
    if (result.status !== 'applied') return result;
    await this.queue(result.deliveries, (ids) => undoRedispatch(this.db, feedbackId, ids));
    return result;
  }

  /**
   * At the Incident's current Level; undone, like a Feedback's, if the queueing fails: a
   * Held Incident it released is Held again.
   */
  async redispatchIncident(incidentId: string): Promise<IncidentRedispatchResult> {
    if (!isUuid(incidentId)) return { status: 'not_found' };
    const result = await redispatchIncident(this.db, incidentId);
    if (result.status !== 'applied') return result;
    await this.queue(result.deliveries, (ids) =>
      undoIncidentRedispatch(this.db, incidentId, ids, result.released),
    );
    return result;
  }

  /**
   * The pending Deliveries created leave with their first job (`dispatchJobId`), as in
   * the Dispatch after Triage or ingestion.
   */
  private async queue(
    created: readonly CreatedDelivery[],
    undo: (deliveryIds: string[]) => Promise<void>,
  ): Promise<void> {
    const pending = created.filter((delivery) => delivery.status === 'pending');
    try {
      await this.dispatchQueue.addBulk(
        pending.map(({ id }) => ({
          name: DISPATCH_JOB,
          data: { deliveryId: id },
          opts: { jobId: dispatchJobId(id) },
        })),
      );
    } catch (error) {
      await undo(pending.map(({ id }) => id));
      throw error;
    }
  }
}
