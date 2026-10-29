import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  closingJobId,
  deriveFingerprint,
  DISPATCH_JOB,
  dispatchJobId,
  INCIDENT_LEVEL_JOB,
  incidentLevelJobId,
  type DispatchJob,
  type IncidentLevelJob,
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
import { DB, DISPATCH_QUEUE_TOKEN, INCIDENT_LEVEL_QUEUE_TOKEN } from '../infra/tokens.js';

/** A `resolved` Occurrence that matched no Open Incident: nothing was recorded. */
const NOTHING_TO_RESOLVE: ReceivedIncident = { id: null, state: null, opened: false };

/**
 * Records an Occurrence: it opens an Incident or is absorbed by the Open one it matches.
 * An Incident that opens with a declared Level is dispatched (`opened`), and so is one
 * whose Level the Occurrence raises (`raised`, to the Destinations the higher Level newly
 * reaches); a `resolved` Occurrence closes the Incident it is absorbed by (`closed`), and
 * opens none. All in the same transaction as the Occurrence.
 *
 * An Incident that opens without a declared Level is not dispatched here: the worker asks
 * the Judge for its Level, within a bounded wait, then runs its Dispatch `opened`. The
 * response never waits for the Judge. Until then, a raise dispatches nothing: the
 * opening goes out at the Level the Incident has by then.
 */
@Injectable()
export class IncidentsIngestionService {
  private readonly logger = new Logger(IncidentsIngestionService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(INCIDENT_LEVEL_QUEUE_TOKEN)
    private readonly incidentLevelQueue: Queue<IncidentLevelJob>,
  ) {}

  /**
   * Once committed, the Occurrence is received: if the queueing of its Deliveries fails,
   * the sweep of the Deliveries left pending sends them; if the queueing of its Level's
   * assessment fails, the sweep of the Incidents left awaiting their Level runs it.
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
    const { received, created, jobId, assess } = await this.db.transaction(async (tx) => {
      const recorded = await recordOccurrence(tx, {
        projectId: project.id,
        fingerprint:
          report.fingerprint ?? deriveFingerprint(project.id, report.title, report.environment),
        level: report.level ?? project.defaultLevel,
        report,
      });
      if (!recorded) {
        return { received: NOTHING_TO_RESOLVE, created: [], jobId: dispatchJobId, assess: false };
      }
      const assess = recorded.opened && recorded.awaitingLevel;
      if (report.resolved) {
        return {
          received: { id: recorded.id, state: 'closed' as const, opened: recorded.opened },
          created: (await closeIncident(tx, recorded.id, 'resolved')) ?? [],
          jobId: closingJobId,
          assess,
        };
      }
      const moment = recorded.awaitingLevel
        ? null
        : recorded.opened
          ? 'opened'
          : recorded.raised
            ? 'raised'
            : null;
      return {
        received: { id: recorded.id, state: 'open' as const, opened: recorded.opened },
        created: moment ? await createMissingIncidentDeliveries(tx, recorded.id, moment) : [],
        jobId: dispatchJobId,
        assess,
      };
    });
    if (assess && received.id) await this.assessLevel(received.id);
    await this.queue(received.id, created, jobId);
    return received;
  }

  private async assessLevel(incidentId: string): Promise<void> {
    try {
      await this.incidentLevelQueue.add(
        INCIDENT_LEVEL_JOB,
        { incidentId },
        { jobId: incidentLevelJobId(incidentId) },
      );
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} recorded but its Level's assessment not queued, the sweep will run it: ${String(error)}`,
      );
    }
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
