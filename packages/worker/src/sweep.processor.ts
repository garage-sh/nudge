import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPATCH_JOB,
  sweepJobId,
  triageJobId,
  TRIAGE_JOB,
  type DispatchJob,
  type TriageJob,
} from '@nudge/core';
import { deliveries, feedbacks, type Db } from '@nudge/database';
import type { JobType, Queue } from 'bullmq';
import { and, asc, eq, lt } from 'drizzle-orm';
import { DEFAULT_SWEEP, type WorkerOptions } from './options.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS, TRIAGE_QUEUE_TOKEN } from './tokens.js';

/** Feedbacks (or Deliveries) queued again per run: the next run picks up the rest. */
const BATCH = 100;

/** States of a job that will eventually process its Delivery: neither finished nor failed. */
const LIVE_JOBS: JobType[] = [
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'paused',
  'waiting-children',
];

/**
 * Sweeps of the Feedbacks left Received (D18) and of the Deliveries left pending (D26).
 * Without an outbox, a Feedback or a Delivery can be stored without its queueing
 * succeeding; its job can also have exhausted its retries without moving it forward
 * (Judge away for long, Postgres unavailable). The sweep queues them again, without
 * doubling a job still waiting or running.
 */
@Injectable()
export class SweepProcessor {
  private readonly logger = new Logger(SweepProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async sweepReceived(): Promise<void> {
    const { delayMs } = this.options.sweep ?? DEFAULT_SWEEP;
    const forgotten = await this.db
      .select({ id: feedbacks.id })
      .from(feedbacks)
      .where(
        and(
          eq(feedbacks.state, 'received'),
          lt(feedbacks.createdAt, new Date(Date.now() - delayMs)),
        ),
      )
      .orderBy(asc(feedbacks.createdAt))
      .limit(BATCH);
    for (const { id } of forgotten) {
      if (await this.restartTriage(id)) {
        this.logger.warn(`Feedback ${id} left Received: sent back to Triage`);
      }
    }
  }

  /**
   * Sends back to dispatch the Deliveries pending for longer than the delay with no live
   * job. A Delivery has several jobs over its life (first delivery, replay, release):
   * they are recognized by the Delivery they carry, not by their id.
   */
  async sweepDeliveries(): Promise<void> {
    const { delayMs } = this.options.sweep ?? DEFAULT_SWEEP;
    const pending = await this.db
      .select({ id: deliveries.id })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.status, 'pending'),
          lt(deliveries.updatedAt, new Date(Date.now() - delayMs)),
        ),
      )
      .orderBy(asc(deliveries.updatedAt))
      .limit(BATCH);
    if (pending.length === 0) return;
    const live = new Set(
      (await this.dispatchQueue.getJobs(LIVE_JOBS))
        .filter((job) => job !== undefined)
        .map((job) => job.data.deliveryId),
    );
    const forgotten = pending.filter(({ id }) => !live.has(id));
    if (forgotten.length === 0) return;
    const run = Date.now();
    await this.dispatchQueue.addBulk(
      forgotten.map(({ id }) => ({
        name: DISPATCH_JOB,
        data: { deliveryId: id },
        opts: { jobId: sweepJobId(id, run) },
      })),
    );
    for (const { id } of forgotten) {
      this.logger.warn(`Delivery ${id} left pending without a job: sent back to dispatch`);
    }
  }

  /** Restarts the Feedback's first Triage job (`triageJobId`). Returns true if it was (re)started. */
  private async restartTriage(feedbackId: string): Promise<boolean> {
    const job = await this.triageQueue.getJob(triageJobId(feedbackId));
    if (job) {
      const jobState = await job.getState();
      if (jobState === 'failed') {
        // Reset, the job gets all its attempts and their backoff back.
        await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
        return true;
      }
      // Waiting, delayed or running: the Triage is under way.
      if (jobState !== 'completed' && jobState !== 'unknown') return false;
      await job.remove();
    }
    await this.triageQueue.add(TRIAGE_JOB, { feedbackId }, { jobId: triageJobId(feedbackId) });
    return true;
  }
}
