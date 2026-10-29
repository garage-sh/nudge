import {
  LEVELS,
  type IncidentCloseCause,
  type IncidentReport,
  type IncidentState,
  type Level,
} from '@nudge/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db, Transaction } from './client.js';
import type { CreatedDelivery } from './dispatch.js';
import { deliveries, incidents, projects } from './schema.js';

export type IncidentRow = typeof incidents.$inferSelect;

/** An Occurrence ready to be recorded: its Fingerprint and the Level it would open with. */
export interface Occurrence {
  readonly projectId: string;
  readonly fingerprint: string;
  /** The declared Level, otherwise the Project's default Level. */
  readonly level: Level;
  readonly report: IncidentReport;
}

/** The Open Incident an Occurrence landed in, and what this Occurrence did to it. */
export interface RecordedOccurrence {
  readonly id: string;
  /** `true` when this Occurrence opened the Incident, `false` when it was absorbed. */
  readonly opened: boolean;
  /** `true` when the Occurrence, absorbed, raised the Level of the Open Incident. */
  readonly raised: boolean;
}

/**
 * Records an Occurrence: it opens an Incident, or is absorbed by the Open Incident of its
 * Project with the same Fingerprint (counter, last seen, last report). Only a declared
 * Level raises the Level of an Incident already open; it never lowers it. The Open
 * Incident is locked until the transaction ends, so the Dispatch the caller runs in the
 * same transaction sees the Level this Occurrence left. Two Occurrences arriving together
 * still open a single Incident: the partial unique index on the Open Incidents makes the
 * second insert wait for the first, then the second Occurrence is absorbed.
 *
 * A `resolved` Occurrence is absorbed like any other (the caller then closes the
 * Incident), but never opens one: with no Open Incident to match, nothing is recorded and
 * `null` is returned. Every Occurrence sets the Incident's Quiet period override to its
 * own (`null` when it sets none).
 */
export async function recordOccurrence(
  tx: Transaction,
  occurrence: Occurrence,
): Promise<RecordedOccurrence | null> {
  const { report } = occurrence;
  const receivedAt = new Date(report.receivedAt);
  const declared = report.level !== null;
  for (;;) {
    const [open] = await tx
      .select({ id: incidents.id, level: incidents.level })
      .from(incidents)
      .where(
        and(
          eq(incidents.projectId, occurrence.projectId),
          eq(incidents.fingerprint, occurrence.fingerprint),
          eq(incidents.state, 'open'),
        ),
      )
      .for('update');
    if (open) {
      const raised = declared && LEVELS.indexOf(occurrence.level) > LEVELS.indexOf(open.level);
      await tx
        .update(incidents)
        .set({
          occurrences: sql`${incidents.occurrences} + 1`,
          lastSeenAt: receivedAt,
          lastReport: report,
          quietPeriod: report.quietPeriod,
          ...(raised ? { level: occurrence.level, levelOrigin: 'declared' as const } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(incidents.id, open.id));
      return { id: open.id, opened: false, raised };
    }
    if (report.resolved) return null;
    const [inserted] = await tx
      .insert(incidents)
      .values({
        projectId: occurrence.projectId,
        fingerprint: occurrence.fingerprint,
        title: report.title,
        environment: report.environment,
        level: occurrence.level,
        levelOrigin: declared ? 'declared' : 'default',
        firstSeenAt: receivedAt,
        lastSeenAt: receivedAt,
        firstReport: report,
        lastReport: report,
        quietPeriod: report.quietPeriod,
      })
      .onConflictDoNothing()
      .returning({ id: incidents.id });
    if (inserted) return { id: inserted.id, opened: true, raised: false };
    // Another Occurrence opened the Incident meanwhile: this one is absorbed by it.
  }
}

/**
 * Closes an Open Incident for good, with its cause, and starts Dispatch `closed`: each
 * Delivery whose opening went out (`delivered`) goes back to pending to carry the
 * closing of what it created. The other Deliveries are left as they are: still pending,
 * held while their Destination is Suspended, or failed, they go out later with the
 * Incident's final state, once, as "opened then closed". Returns the Deliveries to queue
 * after the commit, or `null` if the Incident was not Open (nothing changed).
 */
export async function closeIncident(
  tx: Transaction,
  incidentId: string,
  cause: IncidentCloseCause,
): Promise<CreatedDelivery[] | null> {
  const [closed] = await tx
    .update(incidents)
    .set({ state: 'closed', closeCause: cause, closedAt: sql`now()` })
    .where(and(eq(incidents.id, incidentId), eq(incidents.state, 'open')))
    .returning({ id: incidents.id });
  if (!closed) return null;
  const closings = await tx
    .update(deliveries)
    .set({ status: 'pending', incidentMoment: 'closed', lastError: null })
    .where(and(eq(deliveries.incidentId, incidentId), eq(deliveries.status, 'delivered')))
    .returning({ id: deliveries.id });
  return closings.map(({ id }) => ({ id, status: 'pending' as const }));
}

export type MemberCloseResult =
  | { readonly status: 'closed'; readonly deliveries: readonly CreatedDelivery[] }
  /** The Incident is already Closed: nothing changed. */
  | { readonly status: 'refused'; readonly state: IncidentState }
  | { readonly status: 'not_found' };

/** A Member closes an Open Incident by hand. The caller queues the returned Deliveries. */
export async function closeIncidentByMember(
  db: Db,
  incidentId: string,
): Promise<MemberCloseResult> {
  return db.transaction(async (tx) => {
    const [incident] = await tx
      .select({ state: incidents.state })
      .from(incidents)
      .where(eq(incidents.id, incidentId))
      .for('update');
    if (!incident) return { status: 'not_found' };
    const closings = await closeIncident(tx, incidentId, 'member');
    if (!closings) return { status: 'refused', state: incident.state };
    return { status: 'closed', deliveries: closings };
  });
}

/** An Incident the Quiet period sweep closed, and the Deliveries carrying its closing. */
export interface QuietIncident {
  readonly id: string;
  readonly deliveries: readonly CreatedDelivery[];
}

/**
 * Closes up to `limit` Open Incidents silent past their Quiet period: the last
 * Occurrence's, failing that the Project's, failing that `defaultQuietPeriodMs` (the
 * Instance's). Each one closes in its own transaction, after its row is locked and the
 * silence checked again: an Occurrence absorbed meanwhile keeps it Open.
 */
export async function closeQuietIncidents(
  db: Db,
  defaultQuietPeriodMs: number,
  limit: number,
): Promise<QuietIncident[]> {
  const quietPeriodMs = sql`coalesce(${incidents.quietPeriod} * 1000, ${projects.quietPeriod} * 1000, ${defaultQuietPeriodMs})`;
  const silent = and(
    eq(incidents.state, 'open'),
    sql`${incidents.lastSeenAt} + ${quietPeriodMs} * interval '1 millisecond' <= now()`,
  );
  const due = await db
    .select({ id: incidents.id })
    .from(incidents)
    .innerJoin(projects, eq(projects.id, incidents.projectId))
    .where(silent)
    .orderBy(asc(incidents.lastSeenAt))
    .limit(limit);
  const closed: QuietIncident[] = [];
  for (const { id } of due) {
    const closings = await db.transaction(async (tx) => {
      const [still] = await tx
        .select({ id: incidents.id })
        .from(incidents)
        .innerJoin(projects, eq(projects.id, incidents.projectId))
        .where(and(eq(incidents.id, id), silent))
        .for('update', { of: incidents });
      return still ? closeIncident(tx, id, 'quiet_period') : null;
    });
    if (closings) closed.push({ id, deliveries: closings });
  }
  return closed;
}
