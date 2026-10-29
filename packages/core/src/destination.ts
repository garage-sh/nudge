import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type Author,
  type FailureClass,
  type AuthorTrust,
  type Context,
  type Severity,
  type Source,
  type CaptureType,
  type FeedbackType,
  type IncidentContext,
  type IncidentDispatchMoment,
  type IncidentState,
  type Level,
  type LevelOrigin,
} from '@nudge/shared';
import type { Alert } from './alert.js';

export type { FailureClass } from '@nudge/shared';

/**
 * Destination port: the contract of every adapter (webhook, Discord, Linear…).
 * An adapter is built for ONE Destination, with its decrypted configuration, by a
 * `DestinationAdapterResolver`.
 */

/**
 * The Capture attached to a Feedback, as an adapter receives it: the image is read from
 * storage only by the adapter that attaches it (webhook, Linear).
 */
export interface CaptureToDispatch {
  readonly contentType: CaptureType;
  readonly bytes: number;
  /** The image; `null` if storage no longer has it. Throws if storage is unreachable. */
  read(): Promise<Uint8Array | null>;
}

/**
 * A link to a dashboard screen (`path` starts with `/`), from its public URL
 * (`NUDGE_DASHBOARD_URL`, D12); `null` without it.
 */
export const buildDashboardUrl = (base: string | null | undefined, path: string): string | null =>
  base ? `${base.replace(/\/+$/, '')}${path}` : null;

/** What an adapter receives of a Triaged Feedback. The text is raw: each adapter encodes it for its target. */
export interface FeedbackToDispatch {
  readonly id: string;
  readonly text: string;
  readonly source: Source;
  readonly resolvedType: FeedbackType;
  /** Absent in degraded mode (without a Judge). */
  readonly severity: Severity | null;
  readonly uncertain: boolean;
  readonly author: (Author & { readonly trust: AuthorTrust }) | null;
  readonly context: Context;
  /** `null`: no Capture. Never sent to the Judge, only to Destinations. */
  readonly capture: CaptureToDispatch | null;
  readonly receivedAt: Date;
  /** "View the Feedback" in the dashboard; `null` without `NUDGE_DASHBOARD_URL` (D12). */
  readonly dashboardUrl: string | null;
}

export interface OutgoingDelivery {
  readonly deliveryId: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly feedback: FeedbackToDispatch;
  /** Sample Feedback from the "test" button: no Delivery exists in the database. */
  readonly isTest: boolean;
}

/**
 * What an adapter receives of an Incident. Every text (title, message, Environment,
 * context) comes from the sender: each adapter encodes it for its target.
 */
export interface IncidentToDispatch {
  /** Stable for the Incident's whole life: a receiver tracks the Incident by it. */
  readonly id: string;
  readonly state: IncidentState;
  /** Title, message, Environment and context of the Occurrence that opened the Incident. */
  readonly title: string;
  readonly message: string | null;
  readonly environment: string | null;
  readonly context: IncidentContext;
  /** The Incident's current Level, and where it came from. */
  readonly level: Level;
  readonly levelOrigin: LevelOrigin;
  readonly fingerprint: string;
  /** Occurrences absorbed so far, the first one included. */
  readonly occurrences: number;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  /** "View the Incident" in the dashboard; `null` without `NUDGE_DASHBOARD_URL` (D12). */
  readonly dashboardUrl: string | null;
}

export interface OutgoingIncidentDelivery {
  readonly deliveryId: string;
  readonly project: { readonly id: string; readonly name: string };
  /** The Dispatch moment that created the Delivery: the Incident opened, or rose in Level. */
  readonly moment: IncidentDispatchMoment;
  readonly incident: IncidentToDispatch;
}

export type DeliveryResult =
  | { readonly status: 'delivered'; readonly externalUrl: string | null }
  | { readonly status: 'failed'; readonly failureClass: FailureClass; readonly message: string };

export type DestinationHealth =
  | { readonly reachable: true }
  | { readonly reachable: false; readonly failureClass: FailureClass; readonly message: string };

export interface DestinationAdapter {
  send(delivery: OutgoingDelivery): Promise<DeliveryResult>;
  /**
   * Delivers an Incident that opened, or whose Level rose to reach this Destination: the
   * Destination's single Delivery of that Incident.
   */
  deliverIncident(delivery: OutgoingIncidentDelivery): Promise<DeliveryResult>;
  /**
   * Warns the Members (the Instance's Alert destination): same target, same credentials
   * and same failure classification as a Delivery.
   */
  alert(alert: Alert): Promise<DeliveryResult>;
  healthCheck(): Promise<DestinationHealth>;
}

/** A Destination as read from the database, secrets decrypted. */
export interface ConfiguredDestination {
  readonly id: string;
  /** `null`: the Alert destination, which belongs to the Instance and not to a Project. */
  readonly projectId: string | null;
  readonly name: string;
  /** Adapter key: `webhook`, `discord`, `linear`… */
  readonly type: string;
  /** Non-secret configuration, validated on write by the type's schema (`@nudge/shared`). */
  readonly config: Readonly<Record<string, unknown>>;
  /** Decrypted secrets (tokens, signing secret): they exist in clear only here. */
  readonly secrets: Readonly<Record<string, string>>;
}

export type DestinationAdapterResolver = (destination: ConfiguredDestination) => DestinationAdapter;

/**
 * Delivers through the adapter returned by `adapter()`: an exception, while building it
 * (unknown type, undecryptable secrets) as while sending (network, bug), becomes a
 * transient failure instead of propagating.
 */
export async function deliver(
  adapter: () => DestinationAdapter,
  delivery: OutgoingDelivery,
): Promise<DeliveryResult> {
  return catchingExceptions(() => adapter().send(delivery));
}

/** `deliver()` for an alert: an exception becomes a transient failure. */
export async function sendAlert(
  adapter: () => DestinationAdapter,
  alert: Alert,
): Promise<DeliveryResult> {
  return catchingExceptions(() => adapter().alert(alert));
}

async function catchingExceptions(call: () => Promise<DeliveryResult>): Promise<DeliveryResult> {
  try {
    return await call();
  } catch (error) {
    return failureFromException(error);
  }
}

/** An exception thrown while sending, turned into a transient failure. */
export function failureFromException(
  error: unknown,
): Extract<DeliveryResult, { status: 'failed' }> {
  return {
    status: 'failed',
    failureClass: 'transient',
    message: errorMessage(error),
  };
}

/**
 * The sample Feedback the "test" button sends to a Destination: it goes through the
 * adapter like a real one, marked `isTest`, with no Delivery recorded.
 */
export function testDelivery(
  project: OutgoingDelivery['project'],
  now = new Date(),
): OutgoingDelivery {
  return {
    deliveryId: randomUUID(),
    project,
    isTest: true,
    feedback: {
      id: randomUUID(),
      text: 'Sample feedback sent by nudge to test this Destination.',
      source: 'api',
      resolvedType: 'bug',
      severity: 'minor',
      uncertain: false,
      author: null,
      context: {},
      capture: null,
      receivedAt: now,
      dashboardUrl: null,
    },
  };
}
