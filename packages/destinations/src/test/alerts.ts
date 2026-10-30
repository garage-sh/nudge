import type {
  DestinationSuspendedAlert,
  FeedbackInReviewAlert,
  IncidentStormAlert,
  OutgoingHeldSummary,
} from '@nudge/core';

/**
 * Sample alerts for the contract tests. The names (typed by a Member) and the refusal
 * message (worded by the target) are hostile: each adapter must encode them so that
 * they mention nobody and form no link or formatting.
 */

export const IN_REVIEW_ALERT: FeedbackInReviewAlert = {
  event: 'feedback_in_review',
  id: 'in-review-6f1c2a40-0000-4000-8000-0000000000a1',
  isTest: false,
  at: new Date('2026-10-24T09:30:00.000Z'),
  project: { id: '6f1c2a40-0000-4000-8000-0000000000a2', name: '@everyone *Shop*' },
  feedback: { id: '6f1c2a40-0000-4000-8000-0000000000a1' },
  dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-0000000000a1',
};

export const SUSPENSION_ALERT: DestinationSuspendedAlert = {
  event: 'destination_suspended',
  id: 'suspension-6f1c2a40-0000-4000-8000-0000000000b1-1792834200000',
  isTest: false,
  at: new Date('2026-10-24T09:30:00.000Z'),
  project: { id: '6f1c2a40-0000-4000-8000-0000000000a2', name: 'Shop' },
  destination: {
    id: '6f1c2a40-0000-4000-8000-0000000000b1',
    name: 'Linear [prod](https://trap.test)',
    failureClass: 'auth',
    message: 'HTTP 401: <!channel> @here `token` rejected',
  },
  dashboardUrl: null,
};

export const STORM_ALERT: IncidentStormAlert = {
  event: 'incident_storm',
  id: 'storm-6f1c2a40-0000-4000-8000-0000000000c1',
  isTest: false,
  at: new Date('2026-10-29T08:00:04.000Z'),
  project: { id: '6f1c2a40-0000-4000-8000-0000000000a2', name: '@everyone *Shop*' },
  storm: { held: 3, cap: 20, startedAt: new Date('2026-10-29T08:00:04.000Z') },
  dashboardUrl:
    'https://nudge.example/projects/6f1c2a40-0000-4000-8000-0000000000a2/incidents?held=true',
};

/** The summary of a storm's Held Incidents; the Project name is hostile, as in the alerts. */
export const HELD_SUMMARY: OutgoingHeldSummary = {
  id: 'held-6f1c2a40-0000-4000-8000-0000000000c1-6f1c2a40-0000-4000-8000-0000000000b1',
  project: { id: '6f1c2a40-0000-4000-8000-0000000000a2', name: '@everyone *Shop* <b>' },
  held: {
    count: 37,
    firstOpenedAt: new Date('2026-10-29T08:00:04.000Z'),
    lastOpenedAt: new Date('2026-10-29T08:03:51.000Z'),
  },
  dashboardUrl:
    'https://nudge.example/projects/6f1c2a40-0000-4000-8000-0000000000a2/incidents?held=true',
};
