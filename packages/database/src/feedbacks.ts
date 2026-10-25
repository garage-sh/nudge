import { eq, inArray } from 'drizzle-orm';
import type { Db } from './client.js';
import { captures, feedbacks } from './schema.js';

/** A Feedback as a Member reads it: state, Verdict and Deliveries. */
export async function readFeedback(db: Db, id: string) {
  const feedback = await db.query.feedbacks.findFirst({
    where: eq(feedbacks.id, id),
    with: {
      verdict: true,
      deliveries: { orderBy: (deliveries, { asc }) => [asc(deliveries.createdAt)] },
    },
  });
  return feedback ?? null;
}

export type LoadedFeedback = NonNullable<Awaited<ReturnType<typeof readFeedback>>>;

/** A Feedback kept because its Capture's image could not be erased. */
export interface DeletionFailure {
  readonly feedbackId: string;
  readonly error: unknown;
}

/** What `deleteFeedbacks` did: the deleted Feedback, and the kept ones. */
export interface FeedbackDeletion {
  readonly deleted: readonly string[];
  readonly failures: readonly DeletionFailure[];
}

/**
 * Deletes Feedback and its Captures (Deliveries, Verdict and the Capture's reference go
 * in cascade). Each Capture's image is erased from storage **before** the database row:
 * a Feedback whose image could not be erased is kept, so that the deletion is retried
 * rather than leaving an image nothing references any more.
 */
export async function deleteFeedbacks(
  db: Db,
  ids: readonly string[],
  deleteCapture: (key: string) => Promise<void>,
): Promise<FeedbackDeletion> {
  if (ids.length === 0) return { deleted: [], failures: [] };
  const toErase = await db
    .select({ feedbackId: captures.feedbackId, key: captures.key })
    .from(captures)
    .where(inArray(captures.feedbackId, [...ids]));
  const failures: DeletionFailure[] = [];
  for (const { feedbackId, key } of toErase) {
    try {
      await deleteCapture(key);
    } catch (error) {
      failures.push({ feedbackId, error });
    }
  }
  const kept = new Set(failures.map((failure) => failure.feedbackId));
  const remaining = ids.filter((id) => !kept.has(id));
  const deleted =
    remaining.length === 0
      ? []
      : await db
          .delete(feedbacks)
          .where(inArray(feedbacks.id, remaining))
          .returning({ id: feedbacks.id });
  return { deleted: deleted.map(({ id }) => id), failures };
}
