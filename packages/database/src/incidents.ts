import type { IncidentReport, Level, ReceivedIncident } from '@nudge/shared';
import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { incidents } from './schema.js';

export type IncidentRow = typeof incidents.$inferSelect;

/** An Occurrence ready to be recorded: its Fingerprint and the Level it would open with. */
export interface Occurrence {
  readonly projectId: string;
  readonly fingerprint: string;
  /** The declared Level, otherwise the Project's default Level. */
  readonly level: Level;
  readonly report: IncidentReport;
}

/**
 * Records an Occurrence in one statement: it opens an Incident, or is absorbed by the
 * Open Incident of its Project with the same Fingerprint (counter, last seen, last
 * report). Only a declared Level raises the Level of an Incident already open; it never
 * lowers it. Two Occurrences arriving together still open a single Incident: the
 * partial unique index on the Open Incidents arbitrates.
 */
export async function recordOccurrence(db: Db, occurrence: Occurrence): Promise<ReceivedIncident> {
  const { report } = occurrence;
  const receivedAt = new Date(report.receivedAt);
  const declared = report.level !== null;
  const [row] = await db
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
    })
    .onConflictDoUpdate({
      target: [incidents.projectId, incidents.fingerprint],
      targetWhere: sql`${incidents.state} = 'open'`,
      set: {
        occurrences: sql`${incidents.occurrences} + 1`,
        lastSeenAt: sql`excluded.last_seen_at`,
        lastReport: sql`excluded.last_report`,
        // Every expression reads the row as it was: the origin follows the raise.
        ...(declared
          ? {
              level: sql`greatest(${incidents.level}, excluded.level)`,
              levelOrigin: sql`case when excluded.level > ${incidents.level} then excluded.level_origin else ${incidents.levelOrigin} end`,
            }
          : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning({
      id: incidents.id,
      state: incidents.state,
      // A freshly inserted row has no deleting transaction yet.
      opened: sql<boolean>`xmax = 0`,
    });
  if (!row) throw new Error('Occurrence not recorded');
  return row;
}
