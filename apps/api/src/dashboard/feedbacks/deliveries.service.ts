import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DISPATCH_JOB, replayJobId, type DispatchJob } from '@nudge/core';
import { undoReplay, deliveries, reopenDelivery, type Db } from '@nudge/database';
import type { ApiErrorBody, DeliveryView, DeliveryStatus } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { DELIVERY_DESTINATION_COLUMNS, toDeliveryView } from './delivery-view.js';

/** Manual replay of Deliveries, to recover from a failure or propagate a Verdict correction. */
@Injectable()
export class DeliveriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * Replays a delivered or failed Delivery: the same Delivery goes back to pending and
   * leaves with the current Verdict. Its job has a replay-specific id, the `<deliveryId>`
   * id being taken by the first attempt's job. If the queueing fails, the reopening is
   * undone so that the Member can try again.
   */
  async replay(deliveryId: string): Promise<DeliveryView> {
    if (!isUuid(deliveryId)) throw deliveryNotFound();
    const result = await reopenDelivery(this.db, deliveryId);
    if (result.status === 'not_found') throw deliveryNotFound();
    if (result.status === 'refused') {
      throw new ConflictException({
        error: 'delivery_not_replayable',
        status: result.deliveryStatus,
      } satisfies ApiErrorBody & { status: DeliveryStatus });
    }
    try {
      await this.dispatchQueue.add(
        DISPATCH_JOB,
        { deliveryId },
        { jobId: replayJobId(deliveryId) },
      );
    } catch (error) {
      await undoReplay(this.db, deliveryId, result.before);
      throw error;
    }
    return this.read(deliveryId);
  }

  private async read(deliveryId: string): Promise<DeliveryView> {
    const delivery = await this.db.query.deliveries.findFirst({
      where: eq(deliveries.id, deliveryId),
      with: { destination: { columns: DELIVERY_DESTINATION_COLUMNS } },
    });
    if (!delivery) throw deliveryNotFound();
    return toDeliveryView(delivery);
  }
}

const deliveryNotFound = () =>
  new NotFoundException({ error: 'delivery_not_found' } satisfies ApiErrorBody);
