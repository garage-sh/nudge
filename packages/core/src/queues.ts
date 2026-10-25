import { randomUUID } from 'node:crypto';
import type { FailureClass } from '@nudge/shared';

/**
 * Contract of the BullMQ queues between the api and the worker. The queue is only a
 * transport: the state of a Feedback or a Delivery is always read from the database.
 */

export const TRIAGE_QUEUE = 'triage';
export const DISPATCH_QUEUE = 'dispatch';
/** Member alerts, sent to the Instance's Alert destination (retried). */
export const ALERTS_QUEUE = 'alerts';
/** The worker's scheduled tasks (repeatable jobs): sweep of Feedback left Received… */
export const MAINTENANCE_QUEUE = 'maintenance';
export const SWEEP_RECEIVED_JOB = 'sweep-received';
/** Sweep of the Deliveries left pending without a live dispatch job (D26). */
export const SWEEP_DELIVERIES_JOB = 'sweep-deliveries';
/** Probe of the Suspended Destinations whose cooldown has elapsed. */
export const PROBE_SUSPENDED_JOB = 'probe-suspended';
/** Purge of the Feedback (and its Captures) older than the retention period. */
export const PURGE_RETENTION_JOB = 'purge-retention';

/** Default BullMQ key prefix; the api and the worker must share the same one. */
export const DEFAULT_QUEUE_PREFIX = 'nudge';

/** Job names of the Triage and dispatch queues (a single kind of job each). */
export const TRIAGE_JOB = 'triage';
export const DISPATCH_JOB = 'dispatch';

/** Job id: `triageJobId` or `reviewJobId`. */
export interface TriageJob {
  readonly feedbackId: string;
}

/** Job id: `dispatchJobId`, then `replayJobId`, `releaseJobId`, `sweepJobId`. */
export interface DispatchJob {
  readonly deliveryId: string;
}

/** First Triage job of a Feedback (ingestion, sweep D18): it is queued only once. */
export const triageJobId = (feedbackId: string): string => feedbackId;

/** A Feedback becomes Triaged again through a review only once: a review-specific job is enough. */
export const reviewJobId = (feedbackId: string): string => `${feedbackId}-review`;

/**
 * First dispatch job of a Delivery (after Triage or a redispatch, D22): a Delivery is
 * created only once, and so is its first job. Later jobs have their own id, since this
 * one stays taken by the finished job of the first attempt.
 */
export const dispatchJobId = (deliveryId: string): string => deliveryId;

/** Manual replay of a Delivery (D9): a fresh job per Member request. */
export const replayJobId = (deliveryId: string): string => `${deliveryId}-replay-${randomUUID()}`;

/**
 * Release of a held Delivery, specific to the current hold: a later probe does not
 * duplicate a job that is still pending.
 */
export const releaseJobId = (deliveryId: string, heldAt: Date | null): string =>
  `${deliveryId}-release-${heldAt?.getTime() ?? 0}`;

/**
 * Handing back to dispatch by the sweep (D26), specific to the pass: a failed job keeps
 * its id, the Delivery starts again with all its attempts.
 */
export const sweepJobId = (deliveryId: string, pass: number): string =>
  `${deliveryId}-sweep-${pass}`;

/**
 * An event to report to the Members. The alert is composed when sent, from the
 * database; the job id (`alertJobId`) makes it unique per event.
 */
export type AlertJob =
  | { readonly event: 'feedback_in_review'; readonly feedbackId: string }
  | {
      readonly event: 'destination_suspended';
      readonly destinationId: string;
      readonly failureClass: Exclude<FailureClass, 'permanent'>;
      readonly message: string;
      /** ISO 8601: tells apart two successive Suspensions of the same Destination. */
      readonly suspendedAt: string;
    };

/** One job per event: a Feedback goes In review only once, a Suspension has its date. */
export function alertJobId(job: AlertJob): string {
  return job.event === 'feedback_in_review'
    ? `in-review-${job.feedbackId}`
    : `suspension-${job.destinationId}-${Date.parse(job.suspendedAt)}`;
}

/** Job retry policy: exponential backoff with jitter. */
export interface RetryPolicy {
  readonly attempts: number;
  /** Delay of the first retry; it doubles at each attempt. */
  readonly backoffDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { attempts: 8, backoffDelayMs: 1000 };

/** Default BullMQ options of a queue, according to the retry policy. */
export function jobOptions(policy: RetryPolicy = DEFAULT_RETRY_POLICY) {
  return {
    attempts: policy.attempts,
    backoff: { type: 'exponential', delay: policy.backoffDelayMs, jitter: 0.5 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  } as const;
}
