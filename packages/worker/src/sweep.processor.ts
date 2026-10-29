import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CAPTURE_KEY_PREFIX,
  closingJobId,
  DISPATCH_JOB,
  INCIDENT_LEVEL_JOB,
  incidentLevelSweepJobId,
  sweepJobId,
  triageJobId,
  TRIAGE_JOB,
  type DispatchJob,
  type IncidentLevelJob,
  type TriageJob,
} from '@nudge/core';
import {
  captures,
  closeQuietIncidents,
  deliveries,
  feedbacks,
  incidentsLeftAwaitingLevel,
  rearmForClosing,
  type Db,
} from '@nudge/database';
import type { JobType, Queue } from 'bullmq';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import {
  DEFAULT_CAPTURE_SWEEP,
  DEFAULT_INCIDENTS,
  DEFAULT_SWEEP,
  MAX_TRIAGE_SWEEP_BACKOFF_MS,
  type WorkerOptions,
} from './options.js';
import {
  DB,
  DISPATCH_QUEUE_TOKEN,
  INCIDENT_LEVEL_QUEUE_TOKEN,
  OPTIONS,
  TRIAGE_QUEUE_TOKEN,
} from './tokens.js';

/** Items handled per run (or per page): the next run picks up the rest. */
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

const afterMs = (ms: number) => sql`now() + ${ms} * interval '1 millisecond'`;

/**
 * Sweeps of the Feedbacks left Received (D18), of the Deliveries left pending (D26), of
 * the Capture storage, and of the Open Incidents past their Quiet period. Without an
 * outbox, a Feedback or a Delivery can be stored without its queueing succeeding; its job
 * can also have exhausted its retries without moving it forward (Judge away for long,
 * Postgres unavailable). The sweep queues them again, without doubling a job still
 * waiting or running.
 */
@Injectable()
export class SweepProcessor {
  private readonly logger = new Logger(SweepProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(INCIDENT_LEVEL_QUEUE_TOKEN)
    private readonly incidentLevelQueue: Queue<IncidentLevelJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  /**
   * Sends back to Triage the Feedbacks Received for longer than the delay, the ones due
   * first. Every Feedback looked at is pushed back (`nextTriageSweepAt`): by the delay
   * if its Triage is under way, by a wait that doubles at each re-Triage otherwise. A
   * Feedback the Judge keeps refusing is thus retried less and less often, and never
   * keeps the other Feedbacks left Received out of the batch.
   */
  async sweepReceived(): Promise<void> {
    const { delayMs } = this.options.sweep ?? DEFAULT_SWEEP;
    const due = await this.db
      .select({ id: feedbacks.id, triageSweeps: feedbacks.triageSweeps })
      .from(feedbacks)
      .where(
        and(
          eq(feedbacks.state, 'received'),
          lt(feedbacks.createdAt, new Date(Date.now() - delayMs)),
          or(isNull(feedbacks.nextTriageSweepAt), lte(feedbacks.nextTriageSweepAt, sql`now()`)),
        ),
      )
      .orderBy(sql`${feedbacks.nextTriageSweepAt} asc nulls first`, asc(feedbacks.createdAt))
      .limit(BATCH);
    for (const { id, triageSweeps } of due) {
      const restarted = await this.restartTriage(id);
      const backoffMs = Math.min(
        delayMs * 2 ** Math.min(triageSweeps, 30),
        MAX_TRIAGE_SWEEP_BACKOFF_MS,
      );
      await this.db
        .update(feedbacks)
        .set(
          restarted
            ? {
                triageSweeps: sql`${feedbacks.triageSweeps} + 1`,
                nextTriageSweepAt: afterMs(backoffMs),
              }
            : { nextTriageSweepAt: afterMs(delayMs) },
        )
        .where(and(eq(feedbacks.id, id), eq(feedbacks.state, 'received')));
      if (restarted) {
        this.logger.warn(
          `Feedback ${id} left Received: sent back to Triage (time ${triageSweeps + 1})`,
        );
      }
    }
  }

  /**
   * Sends back to dispatch the Deliveries pending for longer than the delay with no live
   * job. A Delivery has several jobs over its life (first delivery, replay, release):
   * they are recognized by the Delivery they carry, not by their id. The pending
   * Deliveries are read page after page until a batch of forgotten ones is found, so
   * that the Deliveries whose job is under way never fill the batch.
   */
  async sweepDeliveries(): Promise<void> {
    const { delayMs } = this.options.sweep ?? DEFAULT_SWEEP;
    const before = new Date(Date.now() - delayMs);
    let live: Set<string> | null = null;
    const forgotten: string[] = [];
    let after: string | null = null;
    while (forgotten.length < BATCH) {
      const page: { id: string }[] = await this.db
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(
          and(
            eq(deliveries.status, 'pending'),
            lt(deliveries.updatedAt, before),
            after ? gt(deliveries.id, after) : undefined,
          ),
        )
        .orderBy(asc(deliveries.id))
        .limit(BATCH);
      if (page.length === 0) break;
      live ??= await this.liveDeliveries();
      for (const { id } of page) if (!live.has(id)) forgotten.push(id);
      if (page.length < BATCH) break;
      after = page[page.length - 1]!.id;
    }
    if (forgotten.length === 0) return;
    const run = Date.now();
    const batch = forgotten.slice(0, BATCH);
    await this.dispatchQueue.addBulk(
      batch.map((id) => ({
        name: DISPATCH_JOB,
        data: { deliveryId: id },
        opts: { jobId: sweepJobId(id, run) },
      })),
    );
    for (const id of batch) {
      this.logger.warn(`Delivery ${id} left pending without a job: sent back to dispatch`);
    }
  }

  /**
   * Queues again the Level assessment of the Incidents still awaiting their Level past
   * the Judge wait: their job was lost (queueing failed, retries exhausted).
   * Past the wait, the assessment no longer asks the Judge: the default Level applies and
   * the Incident is dispatched. A job still on its way does no harm: the first one to
   * settle the Level wins, the other does nothing.
   */
  async sweepIncidentLevels(): Promise<void> {
    const { judgeWaitMs } = this.options.incidents ?? DEFAULT_INCIDENTS;
    const due = await incidentsLeftAwaitingLevel(
      this.db,
      new Date(Date.now() - judgeWaitMs),
      BATCH,
    );
    if (due.length === 0) return;
    const run = Date.now();
    await this.incidentLevelQueue.addBulk(
      due.map((incidentId) => ({
        name: INCIDENT_LEVEL_JOB,
        data: { incidentId },
        opts: { jobId: incidentLevelSweepJobId(incidentId, run) },
      })),
    );
    for (const id of due) {
      this.logger.warn(`Incident ${id} left awaiting its Level: its assessment queued again`);
    }
  }

  /**
   * Closes the Open Incidents silent past their Quiet period, the longest silent first,
   * and queues the closing their delivered openings carry. It also re-arms the closing
   * of an opening delivered while its Incident closed and missed by the dispatch job
   * (a race with the closing, a worker stop). If the queueing fails, the sweep of the
   * Deliveries left pending sends them.
   */
  async sweepQuietIncidents(): Promise<void> {
    const { quietPeriodMs } = this.options.incidents ?? DEFAULT_INCIDENTS;
    const closed = await closeQuietIncidents(this.db, quietPeriodMs, BATCH);
    for (const { id } of closed) this.logger.log(`Incident ${id} closed: Quiet period over`);
    const missed = await rearmForClosing(this.db, sql`true`);
    for (const { id } of missed) {
      this.logger.warn(`Delivery ${id} delivered its opening without its closing: re-armed`);
    }
    const closings = [...closed.flatMap((incident) => incident.deliveries), ...missed];
    if (closings.length === 0) return;
    try {
      await this.dispatchQueue.addBulk(
        closings.map(({ id }) => ({
          name: DISPATCH_JOB,
          data: { deliveryId: id },
          opts: { jobId: closingJobId(id) },
        })),
      );
    } catch (error) {
      this.logger.error(
        `Closings of quiet Incidents not queued, the sweep of pending Deliveries will send them: ${String(error)}`,
      );
    }
  }

  /**
   * Deletes from the Capture storage the images no Capture references (the api stopped
   * between writing the image and its database row) and what interrupted writes left
   * behind. Objects younger than the grace period are left alone: their row may be on
   * its way.
   */
  async sweepCaptures(): Promise<void> {
    const { graceMs } = this.options.captureSweep ?? DEFAULT_CAPTURE_SWEEP;
    const storage = this.options.captureStorage;
    const before = new Date(Date.now() - graceMs);
    const incomplete = await storage.removeIncomplete(before);
    if (incomplete > 0) {
      this.logger.warn(`${incomplete} interrupted Capture write(s) removed from the storage`);
    }
    let candidates: string[] = [];
    for await (const { key, modifiedAt } of storage.list(CAPTURE_KEY_PREFIX)) {
      if (modifiedAt >= before) continue;
      candidates.push(key);
      if (candidates.length === BATCH) {
        await this.deleteOrphans(candidates);
        candidates = [];
      }
    }
    await this.deleteOrphans(candidates);
  }

  private async deleteOrphans(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    const referenced = new Set(
      (
        await this.db
          .select({ key: captures.key })
          .from(captures)
          .where(inArray(captures.key, [...keys]))
      ).map(({ key }) => key),
    );
    for (const key of keys) {
      if (referenced.has(key)) continue;
      await this.options.captureStorage.delete(key);
      this.logger.warn(`Capture image ${key} referenced by no Feedback: deleted from the storage`);
    }
  }

  /** The Deliveries that a job not yet finished nor failed will process. */
  private async liveDeliveries(): Promise<Set<string>> {
    return new Set(
      (await this.dispatchQueue.getJobs(LIVE_JOBS))
        .filter((job) => job !== undefined)
        .map((job) => job.data.deliveryId),
    );
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
