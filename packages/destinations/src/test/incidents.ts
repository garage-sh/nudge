import type {
  IncidentToDispatch,
  OutgoingIncidentClosing,
  OutgoingIncidentDelivery,
} from '@nudge/core';

/**
 * Incident Deliveries for the adapters' contract tests: an opening, its closing on the
 * same Delivery, and an "opened then closed" single Delivery. Every text the sender
 * controls carries markup and a broad mention, which each target must neutralize.
 */

const OPEN_INCIDENT: IncidentToDispatch = {
  id: '6f1c2a40-0000-4000-8000-0000000000a1',
  state: 'open',
  title: '@everyone <b>Payment</b> timed out',
  message: 'POST /charges took 30 s',
  environment: 'production',
  context: { service: 'checkout', retried: true },
  level: 'error',
  levelOrigin: 'declared',
  fingerprint: 'payments-timeout',
  occurrences: 3,
  firstSeenAt: new Date('2026-10-24T09:00:00.000Z'),
  lastSeenAt: new Date('2026-10-24T09:29:00.000Z'),
  closure: null,
  dashboardUrl: 'https://nudge.example/projects/p/incidents/6f1c2a40-0000-4000-8000-0000000000a1',
};

const CLOSED_INCIDENT: IncidentToDispatch = {
  ...OPEN_INCIDENT,
  state: 'closed',
  occurrences: 5,
  lastSeenAt: new Date('2026-10-24T09:30:00.000Z'),
  closure: { cause: 'resolved', closedAt: new Date('2026-10-24T09:31:00.000Z') },
};

/** The opening of the Incident to a Destination of the Project `projectId`. */
export function incidentOpening(projectId: string): OutgoingIncidentDelivery {
  return {
    deliveryId: '6f1c2a40-0000-4000-8000-0000000000a2',
    project: { id: projectId, name: 'Shop' },
    moment: 'opened',
    incident: OPEN_INCIDENT,
  };
}

/** The closing of that opening, which created `externalUrl` on the target. */
export function incidentClosing(
  projectId: string,
  externalUrl: string | null,
): OutgoingIncidentClosing {
  return {
    ...incidentOpening(projectId),
    moment: 'closed',
    incident: CLOSED_INCIDENT,
    opening: { externalUrl },
  };
}

/** An Incident that closed before its opening could go out: its whole life at once. */
export function incidentOpenedThenClosed(projectId: string): OutgoingIncidentDelivery {
  return { ...incidentOpening(projectId), incident: CLOSED_INCIDENT };
}
