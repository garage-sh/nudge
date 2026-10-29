import { filterAccepts } from '@nudge/core';
import {
  isFeedbackRedispatchable,
  type DeliveryStatus,
  type DestinationState,
  type FeedbackState,
} from '@nudge/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Db, Transaction } from './client.js';
import { filterOf } from './destinations.js';
import { destinations, deliveries, feedbacks, verdicts } from './schema.js';
import {
  deliveriesOf,
  feedbackSubject,
  subjectColumns,
  subjectConflictTarget,
  type DeliverySubject,
} from './subject.js';

/** A Delivery Dispatch has just created: `pending` awaits its job, `held` the probe. */
export interface CreatedDelivery {
  readonly id: string;
  readonly status: Extract<DeliveryStatus, 'pending' | 'held'>;
}

/**
 * Creates, according to the current Verdict, the missing Deliveries to the Project's
 * Destinations whose Filter accepts the Feedback: a single one per (Feedback,
 * Destination), existing Deliveries are never touched. A Delivery to a Suspended
 * Destination is held right away, with no job and no outgoing call. A Triaged Feedback
 * becomes Dispatched as soon as a Filter accepts it. Returns only the Deliveries created
 * by this call; the caller queues the pending ones, after the commit.
 */
export async function createMissingDeliveries(
  tx: Transaction,
  feedbackId: string,
  projectId: string,
): Promise<CreatedDelivery[]> {
  const [verdict] = await tx
    .select({ resolvedType: verdicts.resolvedType, severity: verdicts.severity })
    .from(verdicts)
    .where(eq(verdicts.feedbackId, feedbackId));
  if (!verdict) throw new Error(`Feedback ${feedbackId} to dispatch without a Verdict`);
  const projectDestinations = await tx
    .select({
      id: destinations.id,
      state: destinations.state,
      filterTypes: destinations.filterTypes,
      filterMinimumSeverity: destinations.filterMinimumSeverity,
    })
    .from(destinations)
    .where(eq(destinations.projectId, projectId));
  const targets = projectDestinations.filter((d) => filterAccepts(filterOf(d), verdict));
  if (targets.length === 0) return [];
  const created = await insertDeliveries(tx, feedbackSubject(feedbackId), targets);
  await tx
    .update(feedbacks)
    .set({ state: 'dispatched' })
    .where(and(eq(feedbacks.id, feedbackId), eq(feedbacks.state, 'triaged')));
  return created;
}

/**
 * Creates one Delivery of the subject per target Destination that has none yet, and
 * returns only those created: the unique (subject, Destination) constraint makes a
 * repeated call create nothing. A Delivery to a Suspended Destination is held right away.
 */
export async function insertDeliveries(
  tx: Transaction,
  subject: DeliverySubject,
  targets: readonly { readonly id: string; readonly state: DestinationState }[],
): Promise<CreatedDelivery[]> {
  if (targets.length === 0) return [];
  const created = await tx
    .insert(deliveries)
    .values(
      targets.map((d) => ({
        ...subjectColumns(subject),
        destinationId: d.id,
        ...(d.state === 'suspended' ? { status: 'held' as const, heldAt: sql`now()` } : {}),
      })),
    )
    .onConflictDoNothing({ target: subjectConflictTarget(subject) })
    .returning({ id: deliveries.id, status: deliveries.status });
  return created.map(({ id, status }) => {
    if (status !== 'pending' && status !== 'held') {
      throw new Error(`Delivery ${id} created with unexpected status ${status}`);
    }
    return { id, status };
  });
}

/** The pending Deliveries of the subject: those a job must (still) send. */
export async function pendingDeliveriesOf(
  tx: Transaction | Db,
  subject: DeliverySubject,
): Promise<{ readonly id: string }[]> {
  return tx
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(deliveriesOf(subject), eq(deliveries.status, 'pending')));
}

export type RedispatchResult =
  | { readonly status: 'applied'; readonly deliveries: readonly CreatedDelivery[] }
  /** The Feedback is neither Triaged nor Dispatched: nothing changed. */
  | { readonly status: 'refused'; readonly state: FeedbackState }
  | { readonly status: 'not_found' };

/**
 * Manual redispatch of a Triaged or Dispatched Feedback (D22): the missing Deliveries
 * according to the current Verdict, to propagate a correction or serve a Destination
 * added since. The Feedback's row is locked while it is read and the Deliveries are
 * created: it neither changes state nor disappears meanwhile. The caller queues the
 * returned pending Deliveries.
 */
export async function redispatchFeedback(db: Db, feedbackId: string): Promise<RedispatchResult> {
  return db.transaction(async (tx) => {
    const [feedback] = await tx
      .select({ state: feedbacks.state, projectId: feedbacks.projectId })
      .from(feedbacks)
      .where(eq(feedbacks.id, feedbackId))
      .for('update');
    if (!feedback) return { status: 'not_found' };
    if (!isFeedbackRedispatchable(feedback.state))
      return { status: 'refused', state: feedback.state };
    return {
      status: 'applied',
      deliveries: await createMissingDeliveries(tx, feedbackId, feedback.projectId),
    };
  });
}

/**
 * Undoes a redispatch whose queueing failed: removes the created Deliveries still
 * pending (without a job, nothing would send them), and makes Triaged again a Feedback
 * that no Delivery is left to call Dispatched. The Member can then retry.
 */
export async function undoRedispatch(
  db: Db,
  feedbackId: string,
  deliveryIds: readonly string[],
): Promise<void> {
  if (deliveryIds.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .delete(deliveries)
      .where(and(inArray(deliveries.id, [...deliveryIds]), eq(deliveries.status, 'pending')));
    await tx
      .update(feedbacks)
      .set({ state: 'triaged' })
      .where(
        and(
          eq(feedbacks.id, feedbackId),
          eq(feedbacks.state, 'dispatched'),
          notExists(
            tx
              .select({ id: deliveries.id })
              .from(deliveries)
              .where(deliveriesOf(feedbackSubject(feedbackId))),
          ),
        ),
      );
  });
}
