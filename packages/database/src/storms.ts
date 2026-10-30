import { incidentFilterAccepts } from '@nudge/core';
import { and, asc, count, eq, gte, isNull, lt, lte, type SQL } from 'drizzle-orm';
import type { Db } from './client.js';
import { incidentFilterOf, type DestinationRow } from './destinations.js';
import { destinations, incidents, incidentStorms, projects } from './schema.js';

/*
 * Storms: a Project opening Incidents past its Opening cap. `recordOccurrence` starts a
 * storm with its first Held Incident and extends it with each next one; the worker ends
 * it once the Project is calm again, then sends each Destination concerned a summary.
 */

type StormRow = typeof incidentStorms.$inferSelect;

/** The Held Incidents of the storm: those of its Project opened while it went on, still Held. */
const heldIn = (storm: Pick<StormRow, 'projectId' | 'startedAt' | 'lastHeldAt'>): SQL =>
  and(
    eq(incidents.projectId, storm.projectId),
    eq(incidents.held, true),
    gte(incidents.firstSeenAt, storm.startedAt),
    lte(incidents.firstSeenAt, storm.lastHeldAt),
  )!;

/** A storm as its Member alert reports it. */
export interface StormToAlert {
  readonly project: { readonly id: string; readonly name: string };
  readonly cap: number;
  readonly startedAt: Date;
  /** Incidents Held so far in the storm. */
  readonly held: number;
}

/** The storm, for its alert; `null` if it is gone (its Project deleted). */
export async function readStormToAlert(db: Db, stormId: string): Promise<StormToAlert | null> {
  const [storm] = await db
    .select({
      projectId: incidentStorms.projectId,
      startedAt: incidentStorms.startedAt,
      lastHeldAt: incidentStorms.lastHeldAt,
      cap: incidentStorms.cap,
      project: { id: projects.id, name: projects.name },
    })
    .from(incidentStorms)
    .innerJoin(projects, eq(projects.id, incidentStorms.projectId))
    .where(eq(incidentStorms.id, stormId));
  if (!storm) return null;
  const [held] = await db.select({ held: count() }).from(incidents).where(heldIn(storm));
  return {
    project: storm.project,
    cap: storm.cap,
    startedAt: storm.startedAt,
    held: held?.held ?? 0,
  };
}

/** A storm just ended, and the Destinations whose Incident Filter accepts one of its Held Incidents. */
export interface EndedStorm {
  readonly id: string;
  readonly destinationIds: readonly string[];
}

/**
 * Ends up to `limit` storms during which no Incident was Held for a whole `windowMs`:
 * their Project is back under its Opening cap. Each one ends in its own transaction,
 * after its row is locked and the calm checked again: a Held opening meanwhile keeps it
 * going. Returns, per storm ended, the Destinations a summary goes to.
 */
export async function endCalmStorms(
  db: Db,
  windowMs: number,
  limit: number,
): Promise<EndedStorm[]> {
  const calm = () =>
    and(
      isNull(incidentStorms.endedAt),
      lt(incidentStorms.lastHeldAt, new Date(Date.now() - windowMs)),
    );
  const due = await db
    .select({ id: incidentStorms.id })
    .from(incidentStorms)
    .where(calm())
    .orderBy(asc(incidentStorms.lastHeldAt))
    .limit(limit);
  const ended: EndedStorm[] = [];
  for (const { id } of due) {
    const storm = await db.transaction(async (tx) => {
      const [still] = await tx
        .update(incidentStorms)
        .set({ endedAt: new Date() })
        .where(and(eq(incidentStorms.id, id), calm()))
        .returning();
      return still ?? null;
    });
    if (!storm) continue;
    const held = await heldOf(db, storm);
    const projectDestinations = await db
      .select()
      .from(destinations)
      .where(eq(destinations.projectId, storm.projectId));
    ended.push({
      id,
      destinationIds: projectDestinations
        .filter((destination) => accepted(destination, held).length > 0)
        .map((destination) => destination.id),
    });
  }
  return ended;
}

/** What a summary tells one Destination of the Incidents a storm held. */
export interface HeldSummaryToSend {
  readonly project: { readonly id: string; readonly name: string };
  readonly destination: DestinationRow;
  readonly count: number;
  readonly firstOpenedAt: Date;
  readonly lastOpenedAt: Date;
}

/**
 * The summary of the storm for the Destination, from the Held Incidents its Incident
 * Filter accepts now; `null` when none is left (released by a Redispatch, deleted) or
 * the storm or the Destination is gone.
 */
export async function readHeldSummary(
  db: Db,
  stormId: string,
  destinationId: string,
): Promise<HeldSummaryToSend | null> {
  const [storm] = await db
    .select({
      storm: incidentStorms,
      project: { id: projects.id, name: projects.name },
    })
    .from(incidentStorms)
    .innerJoin(projects, eq(projects.id, incidentStorms.projectId))
    .where(eq(incidentStorms.id, stormId));
  if (!storm) return null;
  const destination = await db.query.destinations.findFirst({
    where: and(
      eq(destinations.id, destinationId),
      eq(destinations.projectId, storm.storm.projectId),
    ),
  });
  if (!destination) return null;
  const openings = accepted(destination, await heldOf(db, storm.storm))
    .map((incident) => incident.firstSeenAt.getTime())
    .sort((a, b) => a - b);
  if (openings.length === 0) return null;
  return {
    project: storm.project,
    destination,
    count: openings.length,
    firstOpenedAt: new Date(openings[0]!),
    lastOpenedAt: new Date(openings.at(-1)!),
  };
}

type HeldIncident = Awaited<ReturnType<typeof heldOf>>[number];

/** The storm's Held Incidents, as the Incident Filter reads them. */
function heldOf(db: Db, storm: StormRow) {
  return db
    .select({
      level: incidents.level,
      environment: incidents.environment,
      firstReport: incidents.firstReport,
      firstSeenAt: incidents.firstSeenAt,
    })
    .from(incidents)
    .where(heldIn(storm));
}

/** The Held Incidents the Destination's Incident Filter accepts, as Dispatch would route them. */
function accepted(destination: DestinationRow, held: readonly HeldIncident[]): HeldIncident[] {
  const filter = incidentFilterOf(destination);
  return held.filter((incident) =>
    incidentFilterAccepts(filter, {
      level: incident.level,
      environment: incident.environment,
      context: incident.firstReport.context,
    }),
  );
}
