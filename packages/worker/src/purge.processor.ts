import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  readInstanceRetention,
  feedbacks,
  deleteFeedbacks,
  purgeEndedStorms,
  purgeIncidents,
  type Db,
} from '@nudge/database';
import { and, asc, lt, notInArray } from 'drizzle-orm';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS } from './tokens.js';

/** Feedbacks (or Incidents) deleted per batch: a purge chains batches until none is left. */
const BATCH = 100;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Retention purge: deletes the Feedbacks older than the Instance retention period,
 * with their Captures, and the Incidents last seen before it, with their Deliveries
 * and the storms that ended before it. Without a period (the default), nothing is
 * purged. The period is read again on every run: changing it in the dashboard is enough.
 */
@Injectable()
export class PurgeProcessor {
  private readonly logger = new Logger(PurgeProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async handle(): Promise<void> {
    const days = await readInstanceRetention(this.db);
    if (days === null) return;
    const before = new Date(Date.now() - days * DAY_MS);
    await this.purgeFeedbacks(days, before);
    await this.purgeIncidents(days, before);
  }

  private async purgeFeedbacks(days: number, before: Date): Promise<void> {
    let total = 0;
    // Feedbacks kept during this run (Capture not deleted): the next batches skip them,
    // so that a Capture that resists does not block the purge of the others.
    const kept: string[] = [];
    for (;;) {
      const batch = await this.db
        .select({ id: feedbacks.id })
        .from(feedbacks)
        .where(
          and(
            lt(feedbacks.createdAt, before),
            kept.length > 0 ? notInArray(feedbacks.id, kept) : undefined,
          ),
        )
        .orderBy(asc(feedbacks.createdAt))
        .limit(BATCH);
      const { deleted, failures } = await deleteFeedbacks(
        this.db,
        batch.map(({ id }) => id),
        (key) => this.options.captureStorage.delete(key),
      );
      total += deleted.length;
      for (const { feedbackId, error } of failures) {
        this.logger.error(`Capture of Feedback ${feedbackId} not deleted: purge retried`, error);
        kept.push(feedbackId);
      }
      // Incomplete batch: nothing else expired this run; the next one retries the kept ones.
      if (batch.length < BATCH) break;
    }
    if (total > 0) this.logger.log(`Retention of ${days} d: ${total} Feedback(s) purged`);
  }

  private async purgeIncidents(days: number, before: Date): Promise<void> {
    let total = 0;
    for (;;) {
      const deleted = await purgeIncidents(this.db, before, BATCH);
      total += deleted;
      if (deleted < BATCH) break;
    }
    await purgeEndedStorms(this.db, before);
    if (total > 0) this.logger.log(`Retention of ${days} d: ${total} Incident(s) purged`);
  }
}
