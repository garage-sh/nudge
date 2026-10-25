import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { triageJobId, TRIAGE_JOB, type TriageJob } from '@nudge/core';
import { captures, feedbacks, type Db } from '@nudge/database';
import type {
  Author,
  CaptureInput,
  ReceivedFeedback,
  ValidatedFeedback,
  Source,
} from '@nudge/shared';
import type { CaptureStorage } from '@nudge/storage';
import type { Queue } from 'bullmq';
import { DB, CAPTURE_STORAGE, TRIAGE_QUEUE_TOKEN } from '../infra/tokens.js';
import { captureKey } from './capture.js';

/** Use case shared by both ingestion paths (public key, secret key). */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(TRIAGE_QUEUE_TOKEN) private readonly triageQueue: Queue<TriageJob>,
    @Inject(CAPTURE_STORAGE) private readonly storage: CaptureStorage,
  ) {}

  /**
   * Stores the Feedback, and its Capture if it has one: the image is written to the
   * storage before the database row. An unavailable storage refuses the Feedback (5xx)
   * rather than keep it without the Capture the Author chose to attach.
   *
   * Once the row is in the database, the Feedback is received: if its queueing fails,
   * the sweep of the Feedbacks left Received (D18) will send it back to Triage.
   */
  async receive(
    projectId: string,
    source: Source,
    feedback: ValidatedFeedback,
  ): Promise<ReceivedFeedback> {
    const id = randomUUID();
    const author = identifiedAuthor(feedback.author);
    const capture = feedback.capture ? await this.store(id, feedback.capture) : null;
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(feedbacks).values({
          id,
          projectId,
          source,
          text: feedback.text,
          declaredType: feedback.type ?? null,
          author,
          // Only the secret key attests the identity; the browser merely declares it.
          authorTrust: author ? (source === 'api' ? 'attested' : 'declared') : null,
          context: feedback.context ?? {},
        });
        if (capture) await tx.insert(captures).values({ feedbackId: id, ...capture });
      });
    } catch (error) {
      // Without a database row, the image would never be read or deleted.
      if (capture) await this.storage.delete(capture.key).catch(() => undefined);
      throw error;
    }
    try {
      await this.triageQueue.add(TRIAGE_JOB, { feedbackId: id }, { jobId: triageJobId(id) });
    } catch (error) {
      this.logger.error(
        `Feedback ${id} stored but not queued, the sweep will triage it: ${String(error)}`,
      );
    }
    return { id, state: 'received' };
  }

  private async store(feedbackId: string, capture: CaptureInput) {
    const content = Buffer.from(capture.data, 'base64');
    const key = captureKey(feedbackId, capture.contentType);
    await this.storage.save(key, content, capture.contentType);
    return { key, contentType: capture.contentType, bytes: content.length };
  }
}

/** An Author without id, email or name identifies no one: there is nothing to attest. */
const identifiedAuthor = (author: Author | undefined): Author | null =>
  author && Object.values(author).some((value) => value) ? author : null;
