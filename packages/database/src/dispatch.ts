import { filterAccepts, incidentFilterAccepts } from '@nudge/core';
import {
  isFeedbackRedispatchable,
  type DeliveryStatus,
  type DestinationState,
  type FeedbackState,
  type IncidentDispatchMoment,
  type IncidentState,
} from '@nudge/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { Db, Transaction } from './client.js';
import { filterOf, incidentFilterOf } from './destinations.js';
import { destinations, deliveries, feedbacks, incidents, verdicts } from './schema.js';
import {
  deliveriesOf,
  feedbackSubject,
  incidentSubject,
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
      filterEnabled: destinations.filterEnabled,
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
 * Creates the missing Deliveries of an Incident to the Project's Destinations whose
 * Incident Filter accepts it at its current Level, with its opening Environment and
 * context: a single one per (Incident, Destination), existing Deliveries are never
 * touched. At `opened`, that is every accepting Destination; at `raised`, only those the
 * higher Level newly reaches, the others already have their Delivery. A Delivery to a
 * Suspended Destination is held right away. A Held Incident (opened past its Project's
 * Opening cap) gets none, whatever the moment. Returns only the Deliveries created by
 * this call; the caller queues the pending ones, after the commit.
 */
export async function createMissingIncidentDeliveries(
  tx: Transaction,
  incidentId: string,
  moment: IncidentDispatchMoment,
): Promise<CreatedDelivery[]> {
  const [incident] = await tx
    .select({
      projectId: incidents.projectId,
      level: incidents.level,
      environment: incidents.environment,
      firstReport: incidents.firstReport,
      held: incidents.held,
    })
    .from(incidents)
    .where(eq(incidents.id, incidentId));
  if (!incident) throw new Error(`Incident ${incidentId} to dispatch not found`);
  if (incident.held) return [];
  const projectDestinations = await tx
    .select({
      id: destinations.id,
      state: destinations.state,
      incidentFilterEnabled: destinations.incidentFilterEnabled,
      incidentFilterMinimumLevel: destinations.incidentFilterMinimumLevel,
      incidentFilterEnvironments: destinations.incidentFilterEnvironments,
      incidentFilterConditions: destinations.incidentFilterConditions,
    })
    .from(destinations)
    .where(eq(destinations.projectId, incident.projectId));
  const targets = projectDestinations.filter((d) =>
    incidentFilterAccepts(incidentFilterOf(d), {
      level: incident.level,
      environment: incident.environment,
      context: incident.firstReport.context,
    }),
  );
  return insertDeliveries(tx, incidentSubject(incidentId), targets, moment);
}

/**
 * Creates one Delivery of the subject per target Destination that has none yet, and
 * returns only those created: the unique (subject, Destination) constraint makes a
 * repeated call create nothing. A Delivery to a Suspended Destination is held right away.
 * `moment`: for an Incident, the Dispatch moment that creates the Deliveries.
 */
export async function insertDeliveries(
  tx: Transaction,
  subject: DeliverySubject,
  targets: readonly { readonly id: string; readonly state: DestinationState }[],
  moment?: IncidentDispatchMoment,
): Promise<CreatedDelivery[]> {
  if (targets.length === 0) return [];
  const created = await tx
    .insert(deliveries)
    .values(
      targets.map((d) => ({
        ...subjectColumns(subject, moment),
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

export type IncidentRedispatchResult =
  | {
      readonly status: 'applied';
      readonly deliveries: readonly CreatedDelivery[];
      /** `true` when the Incident was Held and this Redispatch released it. */
      readonly released: boolean;
    }
  /** The Incident is Closed: nothing changed. */
  | { readonly status: 'refused'; readonly state: IncidentState }
  | { readonly status: 'not_found' };

/**
 * Manual Redispatch of an Open Incident: the missing Deliveries to the Destinations whose
 * Incident Filter now accepts it at its current Level, to serve a Filter changed or a
 * Destination added since. Existing Deliveries are not touched. The Incident's row is
 * locked meanwhile: no Occurrence changes its Level and it does not close in between.
 * An Incident still awaiting its Level gets none: its Dispatch `opened`, which the worker
 * runs once the Level is settled, will reach every Destination accepting it then.
 * A Held Incident is released: it is dispatched from then on like any other, and no
 * longer counts in its storm's summary. The caller queues the returned pending Deliveries.
 */
export async function redispatchIncident(
  db: Db,
  incidentId: string,
): Promise<IncidentRedispatchResult> {
  return db.transaction(async (tx) => {
    const [incident] = await tx
      .select({
        state: incidents.state,
        awaitingLevel: incidents.awaitingLevel,
        held: incidents.held,
      })
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .for('update');
    if (!incident) return { status: 'not_found' };
    if (incident.state !== 'open') return { status: 'refused', state: incident.state };
    const released = incident.held;
    if (released) {
      await tx.update(incidents).set({ held: false }).where(eq(incidents.id, incidentId));
    }
    if (incident.awaitingLevel) return { status: 'applied', deliveries: [], released };
    return {
      status: 'applied',
      deliveries: await createMissingIncidentDeliveries(tx, incidentId, 'opened'),
      released,
    };
  });
}

/**
 * Undoes an Incident's Redispatch whose queueing failed: removes the created Deliveries
 * still pending (without a job, nothing would send them), and makes Held again the
 * Incident it released (`released`). The Member can then retry.
 */
export async function undoIncidentRedispatch(
  db: Db,
  incidentId: string,
  deliveryIds: readonly string[],
  released: boolean,
): Promise<void> {
  if (deliveryIds.length === 0 && !released) return;
  await db.transaction(async (tx) => {
    if (deliveryIds.length > 0) {
      await tx
        .delete(deliveries)
        .where(and(inArray(deliveries.id, [...deliveryIds]), eq(deliveries.status, 'pending')));
    }
    if (released) {
      await tx.update(incidents).set({ held: true }).where(eq(incidents.id, incidentId));
    }
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
