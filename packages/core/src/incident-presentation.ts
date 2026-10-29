import { LEVEL_LABELS } from '@nudge/shared';
import type { PresentedAlert } from './alert.js';
import type { OutgoingIncidentDelivery } from './destination.js';

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
}: OutgoingIncidentDelivery): PresentedIncident {
  const level = LEVEL_LABELS[incident.level];
  const where = incident.environment ? ` (${incident.environment})` : '';
  const context = Object.entries(incident.context);
  return {
    title: `${level} · ${incident.title}`,
    summary:
      moment === 'raised'
        ? `An Incident of ${project.name} rose to ${level}.`
        : `An Incident opened in ${project.name}${where}.`,
    details: [
      { label: 'Project', value: project.name },
      ...(incident.environment ? [{ label: 'Environment', value: incident.environment }] : []),
      { label: 'Level', value: `${level} (${incident.levelOrigin})` },
      { label: 'Occurrences', value: String(incident.occurrences) },
      { label: 'First seen', value: incident.firstSeenAt.toISOString() },
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
