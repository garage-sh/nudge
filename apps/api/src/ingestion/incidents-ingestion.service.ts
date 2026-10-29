import { Inject, Injectable, Logger } from '@nestjs/common';
import { deriveFingerprint, DISPATCH_JOB, dispatchJobId, type DispatchJob } from '@nudge/core';
import {
  createMissingIncidentDeliveries,
  recordOccurrence,
  type CreatedDelivery,
  type Db,
  type Project,
} from '@nudge/database';
import type { IncidentReport, ReceivedIncident, ValidatedIncident } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../infra/tokens.js';

/**
 * Records an Occurrence: it opens an Incident or is absorbed by the Open one it matches.
 * An Incident that opens is dispatched (`opened`), and so is one whose Level the
 * Occurrence raises (`raised`, to the Destinations the higher Level newly reaches), in
 * the same transaction as the Occurrence.
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
      receivedAt: new Date().toISOString(),
    };
    const { received, created } = await this.db.transaction(async (tx) => {
      const recorded = await recordOccurrence(tx, {
        projectId: project.id,
        fingerprint:
          report.fingerprint ?? deriveFingerprint(project.id, report.title, report.environment),
        level: report.level ?? project.defaultLevel,
        report,
      });
      const moment = recorded.opened ? 'opened' : recorded.raised ? 'raised' : null;
      return {
        received: { id: recorded.id, state: recorded.state, opened: recorded.opened },
        created: moment ? await createMissingIncidentDeliveries(tx, recorded.id, moment) : [],
      };
    });
    await this.queue(received.id, created);
    return received;
  }

  private async queue(incidentId: string, created: readonly CreatedDelivery[]): Promise<void> {
    const pending = created.filter((delivery) => delivery.status === 'pending');
    if (pending.length === 0) return;
    try {
      await this.dispatchQueue.addBulk(
        pending.map(({ id }) => ({
          name: DISPATCH_JOB,
          data: { deliveryId: id },
          opts: { jobId: dispatchJobId(id) },
        })),
      );
    } catch (error) {
      this.logger.error(
        `Incident ${incidentId} recorded but its Deliveries not queued, the sweep will send them: ${String(error)}`,
      );
    }
  }
}
