import { randomUUID } from 'node:crypto';
import type { FailureClass } from '@nudge/shared';
import type { PresentedMessage } from './presentation.js';

/**
 * Member alerts: what a Destination adapter receives when the Instance's Alert
 * destination must warn that a Feedback awaits review, that a Destination is
 * Suspended, or that a Project opens Incidents faster than its Opening cap. An alert
 * never carries a Feedback's text: a Feedback In review is suspected of Manipulation,
 * it is read in the dashboard.
 */

interface AlertBase {
  /** Stable from one attempt to the next: a receiver uses it to ignore a duplicate. */
  readonly id: string;
  /** Sample alert from the "test" button. */
  readonly isTest: boolean;
  /** When the reported event happened. */
  readonly at: Date;
  readonly project: { readonly id: string; readonly name: string };
  /** Where to act in the dashboard; `null` without `NUDGE_DASHBOARD_URL` (D12). */
  readonly dashboardUrl: string | null;
}

/** A Feedback suspected of Manipulation awaits a Member's decision. */
export interface FeedbackInReviewAlert extends AlertBase {
  readonly event: 'feedback_in_review';
  readonly feedback: { readonly id: string };
}

/** A Destination has just become Suspended; its Deliveries are held. */
export interface DestinationSuspendedAlert extends AlertBase {
  readonly event: 'destination_suspended';
  readonly destination: {
    readonly id: string;
    readonly name: string;
    /** `auth`: credentials refused; `transient`: repeated failures. */
    readonly failureClass: Exclude<FailureClass, 'permanent'>;
    /** The last refusal, as the target worded it: external text, to encode. */
    readonly message: string;
  };
}

/**
 * A Project went past its Opening cap: the Incidents it opens are Held, not dispatched,
 * until it is back under its cap. One alert per storm.
 */
export interface IncidentStormAlert extends AlertBase {
  readonly event: 'incident_storm';
  readonly storm: {
    /** Incidents Held so far in this storm (at least the one that started it). */
    readonly held: number;
    /** The Opening cap the Project went past, in Incidents per minute. */
    readonly cap: number;
    readonly startedAt: Date;
  };
}

export type Alert = FeedbackInReviewAlert | DestinationSuspendedAlert | IncidentStormAlert;
export type AlertEvent = Alert['event'];

/**
 * The text of an alert, identical for every target: each adapter only encodes it
 * (escaping, mentions, length limits).
 */
export function presentAlert(alert: Alert): PresentedMessage {
  const testPrefix = alert.isTest ? 'Test · ' : '';
  if (alert.event === 'feedback_in_review') {
    return {
      title: `${testPrefix}Feedback in review · ${alert.project.name}`,
      summary:
        'A Feedback seems to try to influence Triage: it goes to no Destination until a Member approves or rejects it.',
      details: [
        { label: 'Project', value: alert.project.name },
        { label: 'Feedback', value: alert.feedback.id },
      ],
    };
  }
  if (alert.event === 'incident_storm') {
    const { storm } = alert;
    return {
      title: `${testPrefix}Incident storm · ${alert.project.name}`,
      summary:
        'The Project opens Incidents faster than its Opening cap: the ones past it are recorded but Held, and go to no Destination. Each Destination concerned receives a single summary once the Project is back under its cap.',
      details: [
        { label: 'Project', value: alert.project.name },
        { label: 'Opening cap', value: `${storm.cap} per minute` },
        { label: 'Held so far', value: String(storm.held) },
      ],
    };
  }
  const { destination } = alert;
  return {
    title: `${testPrefix}Destination suspended · ${destination.name}`,
    summary:
      destination.failureClass === 'auth'
        ? 'The Destination refuses nudge’s credentials: its Deliveries are held until it accepts them again.'
        : 'The Destination fails repeatedly: its Deliveries are held, and nudge probes it until it responds.',
    details: [
      { label: 'Project', value: alert.project.name },
      { label: 'Destination', value: destination.name },
      { label: 'Last refusal', value: destination.message, long: true },
    ],
  };
}

/** The sample alert sent by the Alert destination's "test" button. */
export function testAlert(now = new Date()): FeedbackInReviewAlert {
  return {
    event: 'feedback_in_review',
    id: randomUUID(),
    isTest: true,
    at: now,
    project: { id: randomUUID(), name: 'Sample project' },
    feedback: { id: randomUUID() },
    dashboardUrl: null,
  };
}
