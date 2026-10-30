import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { closingJobId, DISPATCH_JOB, type DispatchJob } from '@nudge/core';
import {
  closeIncidentByMember,
  incidents,
  projects,
  type Db,
  type IncidentRow,
} from '@nudge/database';
import type {
  ApiErrorBody,
  IncidentDetailView,
  IncidentState,
  IncidentPage,
  IncidentSummaryView,
  ProjectRefView,
  incidentFiltersSchema,
} from '@nudge/shared';
import { and, asc, desc, eq, isNotNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Queue } from 'bullmq';
import { DB, DISPATCH_QUEUE_TOKEN } from '../../infra/tokens.js';
import { isUuid } from '../../validation.js';
import { after, decodeCursor, encodeCursor, instantColumn } from '../cursor.js';
import { DELIVERY_DESTINATION_COLUMNS, toDeliveryView } from '../feedbacks/delivery-view.js';

type IncidentFilters = z.output<typeof incidentFiltersSchema>;

/** A Project's Incidents, as a Member reads and closes them (no roles in v1). */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
  ) {}

  /**
   * A Member closes an Open Incident: its Destinations receive the closing, as when its
   * sender resolves it. Once committed, the closing stands: if its queueing fails, the
   * sweep of the Deliveries left pending sends it.
   */
  async close(id: string): Promise<IncidentDetailView> {
    if (!isUuid(id)) throw incidentNotFound();
    const result = await closeIncidentByMember(this.db, id);
    if (result.status === 'not_found') throw incidentNotFound();
    if (result.status === 'refused') {
      throw new ConflictException({
        error: 'incident_not_open',
        state: result.state,
      } satisfies ApiErrorBody & { state: IncidentState });
    }
    if (result.deliveries.length > 0) {
      try {
        await this.dispatchQueue.addBulk(
          result.deliveries.map(({ id: deliveryId }) => ({
            name: DISPATCH_JOB,
            data: { deliveryId },
            opts: { jobId: closingJobId(deliveryId) },
          })),
        );
      } catch (error) {
        this.logger.error(
          `Incident ${id} closed but its closings not queued, the sweep will send them: ${String(error)}`,
        );
      }
    }
    return this.read(id);
  }

  /** A page of the Project's Incidents, newest opened first. */
  async list(filters: IncidentFilters): Promise<IncidentPage> {
    const conditions: SQL[] = [eq(incidents.projectId, filters.project)];
    if (filters.state) conditions.push(eq(incidents.state, filters.state));
    if (filters.level) conditions.push(eq(incidents.level, filters.level));
    if (filters.environment) conditions.push(eq(incidents.environment, filters.environment));
    if (filters.held) conditions.push(eq(incidents.held, true));
    if (filters.cursor) {
      conditions.push(after(incidents.createdAt, incidents.id, decodeCursor(filters.cursor)));
    }
    const rows = await this.db
      .select({
        incident: incidents,
        project: { id: projects.id, name: projects.name },
        instant: instantColumn(incidents.createdAt),
      })
      .from(incidents)
      .innerJoin(projects, eq(projects.id, incidents.projectId))
      .where(and(...conditions))
      .orderBy(desc(incidents.createdAt), desc(incidents.id))
      // One extra row tells whether a next page exists.
      .limit(filters.limit + 1);
    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    return {
      incidents: page.map((row) => toSummary(row.incident, row.project)),
      next:
        rows.length > filters.limit && last
          ? encodeCursor({ instant: last.instant, id: last.incident.id })
          : null,
    };
  }

  /** The Environments the Project's Incidents were opened in, alphabetically: the filter's choices. */
  async environments(projectId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ environment: incidents.environment })
      .from(incidents)
      .where(and(eq(incidents.projectId, projectId), isNotNull(incidents.environment)))
      .orderBy(asc(incidents.environment));
    return rows.flatMap((row) => (row.environment === null ? [] : [row.environment]));
  }

  async read(id: string): Promise<IncidentDetailView> {
    if (!isUuid(id)) throw incidentNotFound();
    const incident = await this.db.query.incidents.findFirst({
      where: eq(incidents.id, id),
      with: {
        project: { columns: { id: true, name: true } },
        deliveries: {
          with: { destination: { columns: DELIVERY_DESTINATION_COLUMNS } },
          orderBy: (deliveries, { asc }) => [asc(deliveries.createdAt), asc(deliveries.id)],
        },
      },
    });
    if (!incident) throw incidentNotFound();
    return {
      ...toSummary(incident, incident.project),
      fingerprint: incident.fingerprint,
      firstReport: incident.firstReport,
      lastReport: incident.lastReport,
      deliveries: incident.deliveries.map(toDeliveryView),
    };
  }
}

const toSummary = (incident: IncidentRow, project: ProjectRefView): IncidentSummaryView => ({
  id: incident.id,
  project,
  state: incident.state,
  title: incident.title,
  level: incident.level,
  levelOrigin: incident.levelOrigin,
  environment: incident.environment,
  occurrences: incident.occurrences,
  firstSeenAt: incident.firstSeenAt.toISOString(),
  lastSeenAt: incident.lastSeenAt.toISOString(),
  closeCause: incident.closeCause,
  closedAt: incident.closedAt?.toISOString() ?? null,
  held: incident.held,
});

export const incidentNotFound = () =>
  new NotFoundException({ error: 'incident_not_found' } satisfies ApiErrorBody);
