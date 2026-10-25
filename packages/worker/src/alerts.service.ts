import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  sendAlert,
  alertJobId,
  buildDashboardUrl,
  type Alert,
  type AlertJob,
  type DestinationAdapterResolver,
  type SecretCipher,
} from '@nudge/core';
import {
  configuredAlertDestination,
  destinations,
  readAlertDestination,
  feedbacks,
  type Db,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { TransientFailure } from './transient-failure.js';
import type { WorkerOptions } from './options.js';
import {
  ALERTS_QUEUE_TOKEN,
  DB,
  DESTINATION_ADAPTER_RESOLVER,
  OPTIONS,
  SECRET_CIPHER,
} from './tokens.js';

/**
 * Member alerts: an event (Feedback moved to In review, Destination Suspended) is
 * queued, then sent to the Instance's Alert destination by the adapter of its type.
 * Without an Alert destination, the job does nothing: the dashboard always shows these
 * states through its badges, read from the database.
 *
 * A transient failure is retried with backoff; auth or permanent is logged, with no
 * retry and no Suspension (the Alert destination has no circuit breaker).
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ALERTS_QUEUE_TOKEN) private readonly queue: Queue<AlertJob>,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  /**
   * Queues the alert of an event. The job id derives from the event: raising it again
   * (retried Triage job) does not make a second one.
   */
  async raise(job: AlertJob): Promise<void> {
    await this.queue.add(job.event, job, { jobId: alertJobId(job) });
  }

  /**
   * Builds the alert from the database and sends it. Throws `TransientFailure` so that
   * BullMQ retries, except on the last attempt.
   */
  async send(
    job: AlertJob,
    { id, raisedAt, lastAttempt }: { id: string; raisedAt: Date; lastAttempt: boolean },
  ): Promise<void> {
    const destination = await readAlertDestination(this.db);
    if (!destination) return;
    const alert = await this.compose(job, id, raisedAt);
    if (!alert) return;
    const result = await sendAlert(
      () => this.resolveDestinationAdapter(configuredAlertDestination(destination, this.cipher)),
      alert,
    );
    if (result.status === 'delivered') return;
    if (result.failureClass === 'transient' && !lastAttempt) {
      throw new TransientFailure(result.message);
    }
    this.logger.error(
      `Alert ${id} not sent to the Alert destination (${result.failureClass}: ${result.message})`,
    );
  }

  /** `null`: the Feedback or the Destination has since been deleted, nothing left to report. */
  private async compose(job: AlertJob, id: string, raisedAt: Date): Promise<Alert | null> {
    if (job.event === 'feedback_in_review') {
      const feedback = await this.db.query.feedbacks.findFirst({
        where: eq(feedbacks.id, job.feedbackId),
        columns: { id: true },
        with: { project: { columns: { id: true, name: true } } },
      });
      if (!feedback) return null;
      return {
        event: 'feedback_in_review',
        id,
        isTest: false,
        at: raisedAt,
        project: feedback.project,
        feedback: { id: feedback.id },
        dashboardUrl: buildDashboardUrl(this.options.dashboardUrl, `/feedbacks/${feedback.id}`),
      };
    }
    const destination = await this.db.query.destinations.findFirst({
      where: eq(destinations.id, job.destinationId),
      columns: { id: true, name: true },
      with: { project: { columns: { id: true, name: true } } },
    });
    if (!destination) return null;
    return {
      event: 'destination_suspended',
      id,
      isTest: false,
      at: new Date(job.suspendedAt),
      project: destination.project,
      destination: {
        id: destination.id,
        name: destination.name,
        failureClass: job.failureClass,
        message: job.message,
      },
      dashboardUrl: buildDashboardUrl(
        this.options.dashboardUrl,
        `/projects/${destination.project.id}/destinations`,
      ),
    };
  }
}
