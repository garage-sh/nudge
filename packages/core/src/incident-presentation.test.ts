import { describe, expect, it } from 'vitest';
import type { OutgoingIncidentClosing, OutgoingIncidentDelivery } from './destination.js';
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
    closure: null,
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

  const closed = (cause: 'resolved' | 'member' | 'quiet_period'): OutgoingIncidentClosing => ({
    ...OPENED,
    moment: 'closed',
    opening: { externalUrl: null },
    incident: {
      ...OPENED.incident,
      state: 'closed',
      message: null,
      context: {},
      occurrences: 3,
      lastSeenAt: new Date('2026-10-29T08:10:00.000Z'),
      closure: { cause, closedAt: new Date('2026-10-29T09:10:00.000Z') },
    },
  });

  it('a closed Incident says why it closed, and when it was last seen and closed', () => {
    expect(presentIncident(closed('quiet_period'))).toEqual({
      title: 'Closed · Error · Payment provider timed out',
      summary: 'An Incident of Shop closed: its Quiet period went by without a new Occurrence.',
      details: [
        { label: 'Project', value: 'Shop' },
        { label: 'Environment', value: 'production' },
        { label: 'Level', value: 'Error (declared)' },
        { label: 'Occurrences', value: '3' },
        { label: 'First seen', value: '2026-10-29T08:00:00.000Z' },
        { label: 'Last seen', value: '2026-10-29T08:10:00.000Z' },
        { label: 'Closed', value: '2026-10-29T09:10:00.000Z' },
      ],
    });
    expect(presentIncident(closed('resolved')).summary).toBe(
      'An Incident of Shop was resolved by its sender.',
    );
    expect(presentIncident(closed('member')).summary).toBe(
      'An Incident of Shop was closed by a Member.',
    );
  });

  it('an Incident delivered once its closing came is presented closed, whatever its opening moment', () => {
    const late: OutgoingIncidentDelivery = { ...OPENED, incident: closed('resolved').incident };
    expect(presentIncident(late).summary).toBe('An Incident of Shop was resolved by its sender.');
  });
});
