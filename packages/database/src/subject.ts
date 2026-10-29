import type { DeliverySubjectKind, IncidentDispatchMoment } from '@nudge/shared';
import { eq, type SQL } from 'drizzle-orm';
import type { IndexColumn } from 'drizzle-orm/pg-core';
import { deliveries } from './schema.js';

/**
 * What a Delivery delivers, named by its kind and the id of the subject: a Feedback, or an
 * Incident. Adding a kind (`DELIVERY_SUBJECTS`) is one more case in each function below,
 * which are the only places that know which column references which subject. Their
 * declared return types make the compiler point at every case left to write.
 */
export interface DeliverySubject {
  readonly kind: DeliverySubjectKind;
  readonly id: string;
}

/** The subject of a Delivery of this Feedback. */
export const feedbackSubject = (feedbackId: string): DeliverySubject => ({
  kind: 'feedback',
  id: feedbackId,
});

/** The subject of a Delivery of this Incident. */
export const incidentSubject = (incidentId: string): DeliverySubject => ({
  kind: 'incident',
  id: incidentId,
});

/**
 * The columns that make a Delivery's row reference its subject. An Incident's Delivery
 * also records the Dispatch moment that creates it (`opened` unless told otherwise).
 */
export function subjectColumns(
  subject: DeliverySubject,
  moment: IncidentDispatchMoment = 'opened',
): Pick<
  typeof deliveries.$inferInsert,
  'subject' | 'feedbackId' | 'incidentId' | 'incidentMoment'
> {
  switch (subject.kind) {
    case 'feedback':
      return { subject: 'feedback', feedbackId: subject.id };
    case 'incident':
      return { subject: 'incident', incidentId: subject.id, incidentMoment: moment };
  }
}

/**
 * The unique constraint that keeps one Delivery per (subject, Destination), as the
 * conflict target of an insert.
 */
export function subjectConflictTarget(subject: DeliverySubject): IndexColumn[] {
  switch (subject.kind) {
    case 'feedback':
      return [deliveries.feedbackId, deliveries.destinationId];
    case 'incident':
      return [deliveries.incidentId, deliveries.destinationId];
  }
}

/** The Deliveries of this subject. */
export function deliveriesOf(subject: DeliverySubject): SQL {
  switch (subject.kind) {
    case 'feedback':
      return eq(deliveries.feedbackId, subject.id);
    case 'incident':
      return eq(deliveries.incidentId, subject.id);
  }
}

/** The subject a Delivery's row references. */
export function subjectOf(row: {
  readonly subject: DeliverySubjectKind;
  readonly feedbackId: string | null;
  readonly incidentId: string | null;
}): DeliverySubject {
  switch (row.subject) {
    case 'feedback':
      if (!row.feedbackId) throw new Error('Delivery of a Feedback without a feedback_id');
      return { kind: 'feedback', id: row.feedbackId };
    case 'incident':
      if (!row.incidentId) throw new Error('Delivery of an Incident without an incident_id');
      return { kind: 'incident', id: row.incidentId };
  }
}
