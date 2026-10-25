import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildTriageState,
  DISPATCH_JOB,
  dispatchJobId,
  stateAfterTriage,
  triageQuestions,
  renderVerdict,
  TRIAGE_INSTRUCTIONS,
  type DispatchJob,
  type TriageAnswers,
  type TriageJob,
} from '@nudge/core';
import { createMissingDeliveries, deliveries, feedbacks, verdicts, type Db } from '@nudge/database';
import {
  JudgeRefusedError,
  JudgeTransientError,
  type Judge,
  type JudgeRequest,
} from '@nudge/judge';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { AlertsService } from './alerts.service.js';
import { withTimeout } from './timeout.js';
import { DEFAULT_JUDGE_TIMEOUT_MS, type WorkerOptions } from './options.js';
import { JudgeResolver } from './judge-resolver.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS } from './tokens.js';

/**
 * Triage then creation of the Deliveries. Every transition is persisted and
 * conditional on the current state: a replayed job resumes where it stopped.
 */
@Injectable()
export class TriageProcessor {
  private readonly logger = new Logger(TriageProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly judgeResolver: JudgeResolver,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    private readonly alerts: AlertsService,
  ) {}

  async handle({ feedbackId }: TriageJob): Promise<void> {
    const feedback = await this.db.query.feedbacks.findFirst({
      where: eq(feedbacks.id, feedbackId),
      with: { project: true },
    });
    if (!feedback) {
      this.logger.warn(`Feedback ${feedbackId} not found, job ignored`);
      return;
    }

    if (feedback.state === 'received') {
      await this.triage(feedback);
    }
    const state = (await this.readState(feedbackId)) ?? feedback.state;
    if (state === 'triaged' || state === 'dispatched') {
      await this.dispatch(feedbackId, feedback.projectId, state);
    }
    // After the commit of the move to In review (decided by `stateAfterTriage`). If the
    // queueing fails, the retried Triage job does it again: the alert is unique per Feedback.
    if (state === 'in_review') {
      await this.alerts.raise({ event: 'feedback_in_review', feedbackId });
    }
  }

  private async triage(feedback: {
    id: string;
    text: string;
    declaredType: (typeof feedbacks.$inferSelect)['declaredType'];
    context: (typeof feedbacks.$inferSelect)['context'];
    project: { description: string | null };
  }): Promise<void> {
    // A Judge error propagates: BullMQ retries with backoff, the Feedback stays Received.
    const judge = await this.judgeResolver.current();
    const answers = judge
      ? await this.judgeWithTimeout(judge, feedback.id, {
          instructions: TRIAGE_INSTRUCTIONS,
          state: buildTriageState({
            text: feedback.text,
            declaredType: feedback.declaredType,
            context: feedback.context,
            projectDescription: feedback.project.description,
          }),
          questions: triageQuestions,
        })
      : null;
    const verdict = renderVerdict(answers, feedback.declaredType, this.options.triageThresholds);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(verdicts)
        .values({ feedbackId: feedback.id, ...verdict })
        .onConflictDoNothing({ target: verdicts.feedbackId });
      await tx
        .update(feedbacks)
        .set({ state: stateAfterTriage(verdict) })
        .where(and(eq(feedbacks.id, feedback.id), eq(feedbacks.state, 'received')));
    });
  }

  /**
   * A Judge that does not answer within the timeout is treated as unavailable: transient
   * error, and the call in flight is aborted rather than left running.
   */
  private async judgeWithTimeout(
    judge: Judge,
    feedbackId: string,
    request: JudgeRequest<typeof triageQuestions>,
  ): Promise<TriageAnswers> {
    const timeoutMs = this.options.judgeTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;
    try {
      return await withTimeout(
        timeoutMs,
        () => new JudgeTransientError(`Judge gave no response after ${timeoutMs} ms`),
        (signal) => judge.judge(request, { signal }),
      );
    } catch (error) {
      // A lasting refusal (key refused, request rejected) does not resolve on its own: it
      // is retried like the rest, but reported so that a Member fixes the configuration.
      if (error instanceof JudgeRefusedError) {
        this.logger.error(
          `Judge: "${error.reason}" refusal for Feedback ${feedbackId}: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /**
   * One Delivery per Destination of the Project whose Filter accepts the Verdict; the
   * Feedback becomes Dispatched as soon as it has one, and stays Triaged if no Filter
   * accepts it. The Delivery is unique per (Feedback, Destination): a replayed job
   * creates no other. A Feedback already Dispatched gets no new Delivery (no
   * retroactive effect of a Destination added or a Filter changed since, except a
   * Member's manual redispatch, D22): the replayed job only queues again its pending
   * Deliveries.
   */
  private async dispatch(
    feedbackId: string,
    projectId: string,
    state: 'triaged' | 'dispatched',
  ): Promise<void> {
    const toSend = await this.db.transaction(async (tx) => {
      if (state === 'triaged') await createMissingDeliveries(tx, feedbackId, projectId);
      return tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.feedbackId, feedbackId), eq(deliveries.status, 'pending')));
    });

    // After the commit: the dispatch job reads a Delivery that exists.
    await this.dispatchQueue.addBulk(
      toSend.map(({ id }) => ({
        name: DISPATCH_JOB,
        data: { deliveryId: id },
        opts: { jobId: dispatchJobId(id) },
      })),
    );
  }

  private async readState(feedbackId: string) {
    const [row] = await this.db
      .select({ state: feedbacks.state })
      .from(feedbacks)
      .where(eq(feedbacks.id, feedbackId));
    return row?.state;
  }
}
