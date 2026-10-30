import {
  LEVELS,
  type IncidentCloseCause,
  type IncidentReport,
  type IncidentState,
  type Level,
} from '@nudge/shared';
import {
  and,
  asc,
  count,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import type { Db, Transaction } from './client.js';
import { createMissingIncidentDeliveries, type CreatedDelivery } from './dispatch.js';
import { deliveries, incidents, incidentStorms, projects } from './schema.js';

export type IncidentRow = typeof incidents.$inferSelect;

/** An Occurrence ready to be recorded: its Fingerprint and the Level it would open with. */
export interface Occurrence {
  readonly projectId: string;
  readonly fingerprint: string;
  /** The declared Level, otherwise the Project's default Level. */
  readonly level: Level;
  readonly report: IncidentReport;
  /**
   * The Project's Opening cap (its own, failing that the Instance's): how many Incidents
   * it may open per `windowMs` and still dispatch.
   */
  readonly openingCap: OpeningCap;
}

/** An Opening cap: how many Incidents a Project may open per `windowMs` and still dispatch. */
export interface OpeningCap {
  readonly limit: number;
  readonly windowMs: number;
}

/** The Open Incident an Occurrence landed in, and what this Occurrence did to it. */
export interface RecordedOccurrence {
  readonly id: string;
  /** `true` when this Occurrence opened the Incident, `false` when it was absorbed. */
  readonly opened: boolean;
  /** `true` when the Occurrence, absorbed, raised the Level of the Open Incident. */
  readonly raised: boolean;
  /**
   * `true` while the Incident waits for the worker to settle its Level (opened without a
   * declared one): its Dispatch `opened` has not run, the worker runs it.
   */
  readonly awaitingLevel: boolean;
  /** `true` when the Incident was opened past the Opening cap: it is not dispatched. */
  readonly held: boolean;
  /** The storm this Occurrence started, by opening the first Held Incident; else `null`. */
  readonly startedStormId: string | null;
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
 * Incident), but never changes its Level and never opens one: with no Open Incident to match, nothing is recorded and
 * `null` is returned. Every Occurrence sets the Incident's Quiet period override to its
 * own (`null` when it sets none).
 *
 * An Incident opened without a declared Level opens awaiting its Level: the worker
 * settles it (`settleIncidentLevel`), then runs its Dispatch `opened`. Meanwhile, the
 * first declared Level sets the Incident's, even below the default one it opened with.
 *
 * An Incident opened past its Project's Opening cap is Held: it is recorded, but no
 * Dispatch ever creates a Delivery for it (`createMissingIncidentDeliveries`), until a
 * Member Redispatches it. The first Held opening of a storm starts it (`startedStormId`).
 */
export async function recordOccurrence(
  tx: Transaction,
  occurrence: Occurrence,
): Promise<RecordedOccurrence | null> {
  const { report } = occurrence;
  const receivedAt = new Date(report.receivedAt);
  const declared = report.level !== null;
  let opening: { held: boolean; startedStormId: string | null } | null = null;
  for (;;) {
    const [open] = await tx
      .select({
        id: incidents.id,
        level: incidents.level,
        levelOrigin: incidents.levelOrigin,
        awaitingLevel: incidents.awaitingLevel,
        held: incidents.held,
      })
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
      const higher = LEVELS.indexOf(occurrence.level) > LEVELS.indexOf(open.level);
      // While the Incident awaits its Level, the default one it holds is a placeholder:
      // the first declared Level replaces it, whatever its rank, and wins over the Judge's.
      const placeholder = open.awaitingLevel && open.levelOrigin !== 'declared';
      // A resolved Occurrence counts, but never changes the Level (D24): not even the
      // placeholder of an Incident awaiting its Level, which the Judge then settles.
      const raised = declared && !report.resolved && (higher || placeholder);
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
      return {
        id: open.id,
        opened: false,
        raised,
        awaitingLevel: open.awaitingLevel,
        held: open.held,
        startedStormId: null,
      };
    }
    if (report.resolved) return null;
    // Decided once: a retry after a concurrent opening finds that Incident Open.
    opening ??= await openingPastCap(tx, occurrence.projectId, receivedAt, occurrence.openingCap);
    const [inserted] = await tx
      .insert(incidents)
      .values({
        projectId: occurrence.projectId,
        fingerprint: occurrence.fingerprint,
        title: report.title,
        environment: report.environment,
        level: occurrence.level,
        levelOrigin: declared ? 'declared' : 'default',
        awaitingLevel: !declared,
        held: opening.held,
        firstSeenAt: receivedAt,
        lastSeenAt: receivedAt,
        firstReport: report,
        lastReport: report,
        quietPeriod: report.quietPeriod,
      })
      .onConflictDoNothing()
      .returning({ id: incidents.id });
    if (inserted) {
      return {
        id: inserted.id,
        opened: true,
        raised: false,
        awaitingLevel: !declared,
        held: opening.held,
        startedStormId: opening.startedStormId,
      };
    }
    // Another Occurrence opened the Incident meanwhile: this one is absorbed by it.
  }
}

/**
 * Whether an Incident opening now goes past its Project's Opening cap: the Project
 * already opened `limit` Incidents in the last window, Held ones included. The Project's
 * row is locked until the transaction ends, so that its openings are counted one after
 * the other. A Held opening extends the storm going on, or starts one (returned).
 */
async function openingPastCap(
  tx: Transaction,
  projectId: string,
  openedAt: Date,
  { limit, windowMs }: OpeningCap,
): Promise<{ held: boolean; startedStormId: string | null }> {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('no key update');
  const [recent] = await tx
    .select({ openings: count() })
    .from(incidents)
    .where(
      and(
        eq(incidents.projectId, projectId),
        gt(incidents.firstSeenAt, new Date(openedAt.getTime() - windowMs)),
      ),
    );
  if ((recent?.openings ?? 0) < limit) return { held: false, startedStormId: null };
  const [ongoing] = await tx
    .update(incidentStorms)
    // Openings are counted one after the other, not in the order of their reception
    // time: the storm only ever widens, so that it covers each of its Held Incidents.
    .set({
      startedAt: sql`least(${incidentStorms.startedAt}, ${openedAt})`,
      lastHeldAt: sql`greatest(${incidentStorms.lastHeldAt}, ${openedAt})`,
    })
    .where(and(eq(incidentStorms.projectId, projectId), isNull(incidentStorms.endedAt)))
    .returning({ id: incidentStorms.id });
  if (ongoing) return { held: true, startedStormId: null };
  const [started] = await tx
    .insert(incidentStorms)
    .values({ projectId, cap: limit, startedAt: openedAt, lastHeldAt: openedAt })
    .returning({ id: incidentStorms.id });
  return { held: true, startedStormId: started?.id ?? null };
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
  return rearmForClosing(tx, { incidentId });
}

/**
 * The Deliveries `rearmForClosing` looks at: those of one Incident, one Delivery, or
 * all of them (the Quiet period sweep).
 */
export type RearmScope = { readonly incidentId: string } | { readonly deliveryId: string } | 'all';

/**
 * Sets back to pending, to carry the closing, the delivered Deliveries in `scope`
 * whose Incident is Closed but that delivered only its opening (moment `opened` or
 * `raised`). An Incident's whole life delivered at once ("opened then closed") is
 * recorded with the moment `closed`, so it never matches. Called when the Incident
 * closes, after an opening that was on its way during the closing, and by the Quiet
 * period sweep, which so catches a closing lost to a race or a worker stop.
 */
export async function rearmForClosing(
  db: Db | Transaction,
  scope: RearmScope,
): Promise<CreatedDelivery[]> {
  const inScope =
    scope === 'all'
      ? undefined
      : 'incidentId' in scope
        ? eq(deliveries.incidentId, scope.incidentId)
        : eq(deliveries.id, scope.deliveryId);
  const rearmed = await db
    .update(deliveries)
    .set({ status: 'pending', incidentMoment: 'closed', lastError: null })
    .where(
      and(
        inScope,
        isNotNull(deliveries.incidentId),
        eq(deliveries.status, 'delivered'),
        ne(deliveries.incidentMoment, 'closed'),
        exists(
          db
            .select({ id: incidents.id })
            .from(incidents)
            .where(and(eq(incidents.id, deliveries.incidentId), eq(incidents.state, 'closed'))),
        ),
      ),
    )
    .returning({ id: deliveries.id });
  return rearmed.map(({ id }) => ({ id, status: 'pending' as const }));
}

/** What a Member's closing of an Incident did. */
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

/** An Incident awaiting its Level, as the worker assesses it. */
export interface IncidentAwaitingLevel {
  readonly id: string;
  readonly firstSeenAt: Date;
  readonly firstReport: IncidentReport;
  readonly projectDescription: string | null;
}

/** The Incident if it still awaits its Level, otherwise `null` (settled, or deleted). */
export async function readIncidentAwaitingLevel(
  db: Db,
  incidentId: string,
): Promise<IncidentAwaitingLevel | null> {
  const [incident] = await db
    .select({
      id: incidents.id,
      firstSeenAt: incidents.firstSeenAt,
      firstReport: incidents.firstReport,
      projectDescription: projects.description,
    })
    .from(incidents)
    .innerJoin(projects, eq(projects.id, incidents.projectId))
    .where(and(eq(incidents.id, incidentId), eq(incidents.awaitingLevel, true)));
  return incident ?? null;
}

/**
 * Settles the Level of an Incident awaiting it, then runs its Dispatch `opened`: the
 * Judge's Level (`judged`, origin `judge`), or with `null` the default Level it opened
 * with. A Level an Occurrence declared meanwhile wins over the Judge's. A Held Incident
 * gets its Level, and no Delivery. A Closed
 * Incident is dispatched all the same: its Deliveries go out once, in its final state
 * ("opened then closed"). Returns the Deliveries to queue after the commit, or `null` if
 * the Incident no longer awaits its Level (settled already, or deleted).
 */
export async function settleIncidentLevel(
  db: Db,
  incidentId: string,
  judged: Level | null,
): Promise<CreatedDelivery[] | null> {
  return db.transaction(async (tx) => {
    const [incident] = await tx
      .select({ levelOrigin: incidents.levelOrigin })
      .from(incidents)
      .where(and(eq(incidents.id, incidentId), eq(incidents.awaitingLevel, true)))
      .for('update');
    if (!incident) return null;
    const applyJudged = judged !== null && incident.levelOrigin !== 'declared';
    await tx
      .update(incidents)
      .set({
        awaitingLevel: false,
        ...(applyJudged ? { level: judged, levelOrigin: 'judge' as const } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(incidents.id, incidentId));
    return createMissingIncidentDeliveries(tx, incidentId, 'opened');
  });
}

/**
 * Up to `limit` Incidents still awaiting their Level although they opened before
 * `openedBefore`: their assessment was lost (queueing failed, retries exhausted).
 */
export async function incidentsLeftAwaitingLevel(
  db: Db,
  openedBefore: Date,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.awaitingLevel, true), lt(incidents.firstSeenAt, openedBefore)))
    .orderBy(asc(incidents.firstSeenAt))
    .limit(limit);
  return rows.map(({ id }) => id);
}

/**
 * Deletion: erases the Incident and, with it, its Deliveries (personal data may have
 * leaked into a report). What the Destinations already created remains. `false` if
 * there was no such Incident.
 */
export async function deleteIncident(db: Db, id: string): Promise<boolean> {
  const deleted = await db
    .delete(incidents)
    .where(eq(incidents.id, id))
    .returning({ id: incidents.id });
  return deleted.length > 0;
}

/**
 * Retention: erases, oldest first, up to `limit` Incidents whose last Occurrence was
 * received before `before`, Open or Closed, with their Deliveries. An Incident opened
 * long ago but still reporting is kept: its last report is recent. Returns how many
 * were erased; fewer than `limit`, none is left.
 */
export async function purgeIncidents(db: Db, before: Date, limit: number): Promise<number> {
  const expired = db
    .select({ id: incidents.id })
    .from(incidents)
    .where(lt(incidents.lastSeenAt, before))
    .orderBy(asc(incidents.lastSeenAt))
    .limit(limit);
  const deleted = await db
    .delete(incidents)
    .where(inArray(incidents.id, expired))
    .returning({ id: incidents.id });
  return deleted.length;
}
