import { Inject, Injectable } from '@nestjs/common';
import { buildDashboardUrl, type OutgoingIncidentDelivery } from '@nudge/core';
import { deliveries, incidents, type Db, type DeliverySubject } from '@nudge/database';
import { eq } from 'drizzle-orm';
import type { PreparedDelivery, SubjectDispatcher } from './subject-dispatcher.js';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS } from './tokens.js';

/**
 * Dispatch of a Delivery whose subject is an Incident: it goes out with the Incident as
 * it is when sent (current Level, counter, last seen), at the Dispatch moment that
 * created the Delivery.
 */
@Injectable()
export class IncidentDispatcher implements SubjectDispatcher {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async prepare(deliveryId: string, { id }: DeliverySubject): Promise<PreparedDelivery> {
    const [delivery] = await this.db
      .select({ moment: deliveries.incidentMoment })
      .from(deliveries)
      .where(eq(deliveries.id, deliveryId));
    const incident = await this.db.query.incidents.findFirst({
      where: eq(incidents.id, id),
      with: { project: { columns: { id: true, name: true } } },
    });
    if (!incident || !delivery) return { status: 'ignored', reason: 'no Incident' };
    if (!delivery.moment) return { status: 'ignored', reason: 'no Dispatch moment' };

    const outgoing: OutgoingIncidentDelivery = {
      deliveryId,
      project: incident.project,
      moment: delivery.moment,
      incident: {
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
        dashboardUrl: buildDashboardUrl(
          this.options.dashboardUrl,
          `/projects/${incident.projectId}/incidents/${incident.id}`,
        ),
      },
    };
    return {
      status: 'ready',
      send: (adapter) => adapter.deliverIncident(outgoing),
      failedInternally: () => false,
    };
  }
}
