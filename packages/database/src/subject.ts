import type { DeliverySubjectKind } from '@nudge/shared';
import { eq, type SQL } from 'drizzle-orm';
import type { IndexColumn } from 'drizzle-orm/pg-core';
import { deliveries } from './schema.js';

/**
 * What a Delivery delivers, named by its kind and the id of the subject. Feedback is the
 * only kind for now: adding one (`DELIVERY_SUBJECTS`) is one more case in each function
 * below, which are the only places that know which column references which subject. Their
 * declared return types make the compiler point at every case left to write.
 */
export interface DeliverySubject {
  readonly kind: DeliverySubjectKind;
  readonly id: string;
}

/** The columns that make a Delivery's row reference its subject. */
export function subjectColumns(
  subject: DeliverySubject,
): Pick<typeof deliveries.$inferInsert, 'subject' | 'feedbackId'> {
  switch (subject.kind) {
    case 'feedback':
      return { subject: 'feedback', feedbackId: subject.id };
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
  }
}

/** The Deliveries of this subject. */
export function deliveriesOf(subject: DeliverySubject): SQL {
  switch (subject.kind) {
    case 'feedback':
      return eq(deliveries.feedbackId, subject.id);
  }
}

/** The subject a Delivery's row references. */
export function subjectOf(row: {
  readonly subject: DeliverySubjectKind;
  readonly feedbackId: string | null;
}): DeliverySubject {
  switch (row.subject) {
    case 'feedback':
      if (!row.feedbackId) throw new Error('Delivery of a Feedback without a feedback_id');
      return { kind: 'feedback', id: row.feedbackId };
  }
}
