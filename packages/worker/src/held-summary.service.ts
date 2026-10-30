import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  buildDashboardUrl,
  heldIncidentsPath,
  heldSummaryJobId,
  sendHeldSummary,
  type DestinationAdapterResolver,
  type HeldSummaryJob,
  type SecretCipher,
} from '@nudge/core';
import { readHeldSummary, toConfiguredDestination, type Db } from '@nudge/database';
import type { WorkerOptions } from './options.js';
import { TransientFailure } from './transient-failure.js';
import { DB, DESTINATION_ADAPTER_RESOLVER, OPTIONS, SECRET_CIPHER } from './tokens.js';

/**
 * The summary of the Incidents a storm held, sent to one Destination once its Project
 * is back under its Opening cap. It is composed when sent, from the Held Incidents the
 * Destination's Incident Filter accepts then: none left (all Redispatched), nothing is
 * sent. No Delivery records it: a transient failure is retried with backoff, auth or
 * permanent is logged, and none counts toward the Destination's Suspension.
 */
@Injectable()
export class HeldSummaryService {
  private readonly logger = new Logger(HeldSummaryService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  /** Throws `TransientFailure` so that BullMQ retries, except on the last attempt. */
  async send(job: HeldSummaryJob, { lastAttempt }: { lastAttempt: boolean }): Promise<void> {
    const summary = await readHeldSummary(this.db, job.stormId, job.destinationId);
    if (!summary) return;
    const result = await sendHeldSummary(
      () =>
        this.resolveDestinationAdapter(toConfiguredDestination(summary.destination, this.cipher)),
      {
        id: heldSummaryJobId(job),
        project: summary.project,
        held: {
          count: summary.count,
          firstOpenedAt: summary.firstOpenedAt,
          lastOpenedAt: summary.lastOpenedAt,
        },
        dashboardUrl: buildDashboardUrl(
          this.options.dashboardUrl,
          heldIncidentsPath(summary.project.id),
        ),
      },
    );
    if (result.status === 'delivered') return;
    if (result.failureClass === 'transient' && !lastAttempt) {
      throw new TransientFailure(result.message);
    }
    this.logger.error(
      `Summary of the Incidents held by storm ${job.stormId} not sent to Destination ${job.destinationId} (${result.failureClass}: ${result.message})`,
    );
  }
}
