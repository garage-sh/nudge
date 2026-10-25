import { isDeliveryReplayable, type DeliveryStatus } from '@nudge/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import { deliveries } from './schema.js';

/** What a Delivery reopened for a replay was before: enough to undo the replay. */
export interface DeliveryBeforeReplay {
  readonly status: DeliveryStatus;
  readonly lastError: string | null;
}

export type ReopenResult =
  | { readonly status: 'reopened'; readonly before: DeliveryBeforeReplay }
  /** The Delivery is neither delivered nor failed: it already has a job, or it is held. */
  | { readonly status: 'refused'; readonly deliveryStatus: DeliveryStatus }
  | { readonly status: 'not_found' };

/**
 * Reopens a delivered or failed Delivery to replay it (D9): the same Delivery goes back
 * to pending, never a second one. The row is locked while it is read and updated: two
 * simultaneous replays reopen it only once. The link to the object already created stays
 * until the next delivery. The caller queues the Delivery.
 */
export async function reopenDelivery(db: Db, deliveryId: string): Promise<ReopenResult> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({ status: deliveries.status, lastError: deliveries.lastError })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .for('update');
    if (!delivery) return { status: 'not_found' };
    if (!isDeliveryReplayable(delivery.status))
      return { status: 'refused', deliveryStatus: delivery.status };
    await tx
      .update(deliveries)
      .set({ status: 'pending', lastError: null })
      .where(eq(deliveries.id, deliveryId));
    return { status: 'reopened', before: delivery };
  });
}

/**
 * Undoes the reopening as long as nothing followed it (the Delivery is still pending):
 * used when queueing the replay failed.
 */
export async function undoReplay(
  db: Db,
  deliveryId: string,
  before: DeliveryBeforeReplay,
): Promise<void> {
  await db
    .update(deliveries)
    .set(before)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'pending')));
}
