import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  closingJobId,
  deriveFingerprint,
  DISPATCH_JOB,
  dispatchJobId,
  type DispatchJob,
} from '@nudge/core';
import {
  closeIncident,
  createMissingIncidentDeliveries,
  recordOccurrence,
  type CreatedDelivery,
  type Db,
  type Project,
} from '@nudge/database';
import type { IncidentReport, ReceivedIncident, ValidatedIncident } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../infra/tokens.js';

/** A `resolved` Occurrence that matched no Open Incident: nothing was recorded. */
const NOTHING_TO_RESOLVE: ReceivedIncident = { id: null, state: null, opened: false };

/**
 * Records an Occurrence: it opens an Incident or is absorbed by the Open one it matches.
 * An Incident that opens is dispatched (`opened`), and so is one whose Level the
 * Occurrence raises (`raised`, to the Destinations the higher Level newly reaches); a
 * `resolved` Occurrence closes the Incident it is absorbed by (`closed`), and opens none.
 * All in the same transaction as the Occurrence.
 */
@Injectable()
export class IncidentsIngestionService {
  private readonly logger = new Logger(IncidentsIngestionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * Once committed, the Occurrence is received: if the queueing of its Deliveries fails,
   * the sweep of the Deliveries left pending sends them.
   */
  async receive(project: Project, occurrence: ValidatedIncident): Promise<ReceivedIncident> {
    const report: IncidentReport = {
      title: occurrence.title,
      message: occurrence.message ?? null,
      level: occurrence.level ?? null,
      environment: occurrence.environment ?? null,
      fingerprint: occurrence.fingerprint ?? null,
      context: occurrence.context ?? {},
      quietPeriod: occurrence.quietPeriod ?? null,
      resolved: occurrence.resolved ?? false,
      receivedAt: new Date().toISOString(),
    };
    const { received, created, jobId } = await this.db.transaction(async (tx) => {
      const recorded = await recordOccurrence(tx, {
        projectId: project.id,
        fingerprint:
          report.fingerprint ?? deriveFingerprint(project.id, report.title, report.environment),
        level: report.level ?? project.defaultLevel,
        report,
      });
      if (!recorded) return { received: NOTHING_TO_RESOLVE, created: [], jobId: dispatchJobId };
      if (report.resolved) {
        return {
          received: { id: recorded.id, state: 'closed' as const, opened: recorded.opened },
          created: (await closeIncident(tx, recorded.id, 'resolved')) ?? [],
          jobId: closingJobId,
        };
      }
      const moment = recorded.opened ? 'opened' : recorded.raised ? 'raised' : null;
      return {
        received: { id: recorded.id, state: 'open' as const, opened: recorded.opened },
        created: moment ? await createMissingIncidentDeliveries(tx, recorded.id, moment) : [],
        jobId: dispatchJobId,
      };
    });
    await this.queue(received.id, created, jobId);
    return received;
  }

  /** `jobId`: the first job of a new Delivery, or the closing job of an opening's. */
  private async queue(
    incidentId: string | null,
    created: readonly CreatedDelivery[],
    jobId: (deliveryId: string) => string,
  ): Promise<void> {
    const pending = created.filter((delivery) => delivery.status === 'pending');
    if (pending.length === 0) return;
    try {
      await this.dispatchQueue.addBulk(
        pending.map(({ id }) => ({
          name: DISPATCH_JOB,
          data: { deliveryId: id },
          opts: { jobId: jobId(id) },
        })),
      );
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} recorded but its Deliveries not queued, the sweep will send them: ${String(error)}`,
      );
    }
  }
}
