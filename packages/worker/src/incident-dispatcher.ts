import { Inject, Injectable } from '@nestjs/common';
import {
  buildDashboardUrl,
  closingJobId,
  DISPATCH_JOB,
  type DispatchJob,
  type IncidentToDispatch,
  type OutgoingIncidentClosing,
  type OutgoingIncidentDelivery,
} from '@nudge/core';
import {
  deliveries,
  incidents,
  rearmForClosing,
  type Db,
  type DeliverySubject,
} from '@nudge/database';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { PreparedDelivery, SubjectDispatcher } from './subject-dispatcher.js';
import type { WorkerOptions } from './options.js';
import { DB, DISPATCH_QUEUE_TOKEN, OPTIONS } from './tokens.js';

/**
 * Dispatch of a Delivery whose subject is an Incident: it goes out with the Incident as
 * it is when sent (current Level, counter, last seen, closure). At `opened` or `raised`,
 * it is the Incident's opening — and its whole life, "opened then closed", when the
 * Incident closed before it could go out. At `closed`, it closes what its opening created.
 */
@Injectable()
export class IncidentDispatcher implements SubjectDispatcher {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  async prepare(deliveryId: string, { id }: DeliverySubject): Promise<PreparedDelivery> {
    const [delivery] = await this.db
      .select({ moment: deliveries.incidentMoment, externalUrl: deliveries.externalUrl })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    const incident = await this.db.query.incidents.findFirst({
      where: eq(incidents.id, id),
      with: { project: { columns: { id: true, name: true } } },
    });
    if (!incident || !delivery) return { status: 'ignored', reason: 'no Incident' };
    if (!delivery.moment) return { status: 'ignored', reason: 'no Dispatch moment' };

    const toDispatch: IncidentToDispatch = {
      id: incident.id,
      state: incident.state,
      title: incident.title,
      message: incident.firstReport.message,
      environment: incident.environment,
      context: incident.firstReport.context,
      level: incident.level,
      levelOrigin: incident.levelOrigin,
      fingerprint: incident.fingerprint,
      occurrences: incident.occurrences,
      firstSeenAt: incident.firstSeenAt,
      lastSeenAt: incident.lastSeenAt,
      closure:
        incident.closeCause && incident.closedAt
          ? { cause: incident.closeCause, closedAt: incident.closedAt }
          : null,
      dashboardUrl: buildDashboardUrl(
        this.options.dashboardUrl,
        `/projects/${incident.projectId}/incidents/${incident.id}`,
      ),
    };
    const common = { deliveryId, project: incident.project, incident: toDispatch };
    if (delivery.moment === 'closed') {
      const closing: OutgoingIncidentClosing = {
        ...common,
        moment: 'closed',
        opening: { externalUrl: delivery.externalUrl },
      };
      return {
        status: 'ready',
        // The Delivery keeps pointing at what its opening created.
        send: async (adapter) => {
          const result = await adapter.closeIncident(closing);
          return result.status === 'delivered'
            ? { ...result, externalUrl: delivery.externalUrl }
            : result;
        },
        failedInternally: () => false,
      };
    }
    const opening: OutgoingIncidentDelivery = { ...common, moment: delivery.moment };
    if (toDispatch.closure) {
      // Its whole life at once, "opened then closed": recorded as its closing.
      return {
        status: 'ready',
        send: (adapter) => adapter.deliverIncident(opening),
        failedInternally: () => false,
        deliveredAs: { incidentMoment: 'closed' },
      };
    }
    return {
      status: 'ready',
      send: (adapter) => adapter.deliverIncident(opening),
      failedInternally: () => false,
      delivered: () => this.closeIfClosedMeanwhile(deliveryId),
    };
  }

  /**
   * The Incident closed while this Delivery's opening was being sent, Open: the closing
   * found it still pending and left it alone. Now delivered, it carries the closing. If
   * this misses it (the closing not committed yet, a worker stop), the Quiet period
   * sweep re-arms it.
   */
  private async closeIfClosedMeanwhile(deliveryId: string): Promise<void> {
    const rearmed = await rearmForClosing(this.db, eq(deliveries.id, deliveryId));
    if (rearmed.length === 0) return;
    await this.dispatchQueue.add(DISPATCH_JOB, { deliveryId }, { jobId: closingJobId(deliveryId) });
  }
}
