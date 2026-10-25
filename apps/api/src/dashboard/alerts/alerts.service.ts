import { Inject, Injectable } from '@nestjs/common';
import { destinations, projects, feedbacks, type Db } from '@nudge/database';
import type { AlertsView } from '@nudge/shared';
import { asc, count, eq } from 'drizzle-orm';
import { DB } from '../../infra/tokens.js';

/**
 * What awaits a Member (Feedbacks In review, Suspended Destinations), read from the
 * database on every call. The alerts sent to the Alert destination leave from the worker.
 */
@Injectable()
export class AlertsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async read(): Promise<AlertsView> {
    const [[inReview], suspended] = await Promise.all([
      this.db.select({ total: count() }).from(feedbacks).where(eq(feedbacks.state, 'in_review')),
      this.db
        .select({
          id: destinations.id,
          name: destinations.name,
          project: { id: projects.id, name: projects.name },
        })
        .from(destinations)
        .innerJoin(projects, eq(projects.id, destinations.projectId))
        .where(eq(destinations.state, 'suspended'))
        .orderBy(asc(destinations.suspendedAt), asc(destinations.id)),
    ]);
    return { feedbacksInReview: inReview?.total ?? 0, suspendedDestinations: suspended };
  }
}
