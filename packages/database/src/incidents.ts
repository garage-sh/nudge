import { LEVELS, type IncidentReport, type Level, type ReceivedIncident } from '@nudge/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Transaction } from './client.js';
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

/** The Incident an Occurrence landed in, and whether this Occurrence raised its Level. */
export interface RecordedOccurrence extends ReceivedIncident {
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
 */
export async function recordOccurrence(
  tx: Transaction,
  occurrence: Occurrence,
): Promise<RecordedOccurrence> {
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
          ...(raised ? { level: occurrence.level, levelOrigin: 'declared' as const } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(incidents.id, open.id));
      return { id: open.id, state: 'open', opened: false, raised };
    }
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
      })
      .onConflictDoNothing()
      .returning({ id: incidents.id });
    if (inserted) return { id: inserted.id, state: 'open', opened: true, raised: false };
    // Another Occurrence opened the Incident meanwhile: this one is absorbed by it.
  }
}
