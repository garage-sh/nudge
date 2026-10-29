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
import { deliveries, incidents, type Db, type DeliverySubject } from '@nudge/database';
import type { Queue } from 'bullmq';
import { and, eq, exists, ne } from 'drizzle-orm';
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
        send: (adapter) => adapter.closeIncident(closing),
        failedInternally: () => false,
      };
    }
    const opening: OutgoingIncidentDelivery = { ...common, moment: delivery.moment };
    return {
      status: 'ready',
      send: (adapter) => adapter.deliverIncident(opening),
      failedInternally: () => false,
      // Closed while its opening was on its way: the opening went out Open, its closing
      // must follow.
      delivered: toDispatch.closure ? undefined : () => this.closeIfClosedMeanwhile(deliveryId),
    };
  }

  /**
   * The Incident closed while this Delivery's opening was being sent: the closing found
   * it still pending and left it alone. Now delivered, it goes back to pending to carry
   * the closing, like the Deliveries delivered at closing time. Queued here; if that
   * fails, the sweep of the Deliveries left pending sends it.
   */
  private async closeIfClosedMeanwhile(deliveryId: string): Promise<void> {
    const [reopened] = await this.db
      .update(deliveries)
      .set({ status: 'pending', incidentMoment: 'closed', lastError: null })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          eq(deliveries.status, 'delivered'),
          ne(deliveries.incidentMoment, 'closed'),
          exists(
            this.db
              .select({ id: incidents.id })
              .from(incidents)
              .where(and(eq(incidents.id, deliveries.incidentId), eq(incidents.state, 'closed'))),
          ),
        ),
      )
      .returning({ id: deliveries.id });
    if (!reopened) return;
    await this.dispatchQueue.add(DISPATCH_JOB, { deliveryId }, { jobId: closingJobId(deliveryId) });
  }
}
