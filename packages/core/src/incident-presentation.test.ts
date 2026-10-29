import { describe, expect, it } from 'vitest';
import type { OutgoingIncidentDelivery } from './destination.js';
import { presentIncident } from './incident-presentation.js';

const OPENED: OutgoingIncidentDelivery = {
  deliveryId: 'delivery-1',
  project: { id: 'project-1', name: 'Shop' },
  moment: 'opened',
  incident: {
    id: 'incident-1',
    state: 'open',
    title: 'Payment provider timed out',
    message: 'POST /charges took 30 s',
    environment: 'production',
    context: { service: 'checkout', retried: true, region: null },
    level: 'error',
    levelOrigin: 'declared',
    fingerprint: 'fp',
    occurrences: 1,
    firstSeenAt: new Date('2026-10-29T08:00:00.000Z'),
    lastSeenAt: new Date('2026-10-29T08:00:00.000Z'),
    dashboardUrl: null,
  },
};

describe('The presentation of an Incident, shared by the adapters', () => {
  it('an opened Incident: its Level and title, where it runs, and what it reported', () => {
    expect(presentIncident(OPENED)).toEqual({
      title: 'Error · Payment provider timed out',
      summary: 'An Incident opened in Shop (production).',
      details: [
        { label: 'Project', value: 'Shop' },
        { label: 'Environment', value: 'production' },
        { label: 'Level', value: 'Error (declared)' },
        { label: 'Occurrences', value: '1' },
        { label: 'First seen', value: '2026-10-29T08:00:00.000Z' },
        { label: 'Message', value: 'POST /charges took 30 s', long: true },
        { label: 'Context', value: 'service: checkout\nretried: true\nregion: null', long: true },
      ],
    });
  });

  it('a raised Incident says its Level rose; without an Environment, message or context, none is shown', () => {
    const raised: OutgoingIncidentDelivery = {
      ...OPENED,
      moment: 'raised',
      incident: {
        ...OPENED.incident,
        environment: null,
        message: null,
        context: {},
        level: 'critical',
        occurrences: 7,
      },
    };
    expect(presentIncident(raised)).toEqual({
      title: 'Critical · Payment provider timed out',
      summary: 'An Incident of Shop rose to Critical.',
      details: [
        { label: 'Project', value: 'Shop' },
        { label: 'Level', value: 'Critical (declared)' },
        { label: 'Occurrences', value: '7' },
        { label: 'First seen', value: '2026-10-29T08:00:00.000Z' },
      ],
    });
  });
});
