import { LEVEL_LABELS, type IncidentCloseCause } from '@nudge/shared';
import type { PresentedAlert } from './alert.js';
import type {
  OutgoingHeldSummary,
  OutgoingIncidentClosing,
  OutgoingIncidentDelivery,
} from './destination.js';

/**
 * An Incident put into words, shared by the adapters that write a message: the same
 * shape as a Member alert's (`PresentedAlert`). The title, the message, the Environment
 * and the context come from the sender: external text, encoded by each adapter.
 */
export type PresentedIncident = PresentedAlert;

/**
 * The text of an Incident Delivery, identical for every target: each adapter only
 * encodes it (escaping, mentions, length limits).
 */
export function presentIncident({
  project,
  moment,
  incident,
}: OutgoingIncidentDelivery | OutgoingIncidentClosing): PresentedIncident {
  const level = LEVEL_LABELS[incident.level];
  const where = incident.environment ? ` (${incident.environment})` : '';
  const context = Object.entries(incident.context);
  const { closure } = incident;
  return {
    title: `${closure ? 'Closed · ' : ''}${level} · ${incident.title}`,
    summary: closure
      ? CLOSED_SUMMARIES[closure.cause](project.name)
      : moment === 'raised'
        ? `An Incident of ${project.name} rose to ${level}.`
        : `An Incident opened in ${project.name}${where}.`,
    details: [
      { label: 'Project', value: project.name },
      ...(incident.environment ? [{ label: 'Environment', value: incident.environment }] : []),
      { label: 'Level', value: `${level} (${incident.levelOrigin})` },
      { label: 'Occurrences', value: String(incident.occurrences) },
      { label: 'First seen', value: incident.firstSeenAt.toISOString() },
      ...(closure
        ? [
            { label: 'Last seen', value: incident.lastSeenAt.toISOString() },
            { label: 'Closed', value: closure.closedAt.toISOString() },
          ]
        : []),
      ...(incident.message ? [{ label: 'Message', value: incident.message, long: true }] : []),
      ...(context.length > 0
        ? [
            {
              label: 'Context',
              value: context.map(([key, value]) => `${key}: ${String(value)}`).join('\n'),
              long: true,
            },
          ]
        : []),
    ],
  };
}

/** Why the Incident closed, in a sentence. */
const CLOSED_SUMMARIES: Readonly<Record<IncidentCloseCause, (project: string) => string>> = {
  resolved: (project) => `An Incident of ${project} was resolved by its sender.`,
  member: (project) => `An Incident of ${project} was closed by a Member.`,
  quiet_period: (project) =>
    `An Incident of ${project} closed: its Quiet period went by without a new Occurrence.`,
};

/**
 * The text of the summary of the Incidents a storm held, identical for every target. It
 * carries no text of the sender: only counts and times; the Project name (typed by a
 * Member) is in the title and the details only, which each adapter encodes.
 */
export function presentHeldSummary({ project, held }: OutgoingHeldSummary): PresentedIncident {
  const incidents = held.count === 1 ? '1 Incident was' : `${held.count} Incidents were`;
  return {
    title: `Incidents held · ${project.name}`,
    summary: `The Project opened Incidents faster than its Opening cap: ${incidents} held and not sent here. They are listed in nudge, where a Member can Redispatch the ones still Open.`,
    details: [
      { label: 'Project', value: project.name },
      { label: 'Held', value: String(held.count) },
      { label: 'First opened', value: held.firstOpenedAt.toISOString() },
      { label: 'Last opened', value: held.lastOpenedAt.toISOString() },
    ],
  };
}
