import type {
  Alert,
  FailureClass,
  DestinationAdapter,
  OutgoingDelivery,
  OutgoingHeldSummary,
  OutgoingIncidentClosing,
  OutgoingIncidentDelivery,
  DeliveryResult,
  DestinationHealth,
} from '@nudge/core';

/**
 * Test Destination plugged into the port: it records Deliveries and can
 * simulate transient, auth and permanent failures.
 */
export class FakeDestination implements DestinationAdapter {
  /** The delivered Deliveries, in order. */
  readonly deliveries: OutgoingDelivery[] = [];
  /** Every call to `send`, delivered or not. */
  readonly attempts: OutgoingDelivery[] = [];
  /** Time (`performance.now()`) of each call to `send`, in the order of `attempts`. */
  readonly attemptTimes: number[] = [];
  /** Time (`performance.now()`) of each call to `healthCheck`, in order. */
  readonly healthCheckTimes: number[] = [];
  /** The delivered Incident Deliveries, in order. */
  readonly incidents: OutgoingIncidentDelivery[] = [];
  /** Every call to `deliverIncident`, delivered or not. */
  readonly incidentAttempts: OutgoingIncidentDelivery[] = [];
  /** The delivered closings of Incidents, in order. */
  readonly closings: OutgoingIncidentClosing[] = [];
  /** Every call to `closeIncident`, delivered or not. */
  readonly closingAttempts: OutgoingIncidentClosing[] = [];
  /** The delivered summaries of Held Incidents, in order. */
  readonly heldSummaries: OutgoingHeldSummary[] = [];
  /** The delivered alerts, in order (the Instance's Alert destination). */
  readonly alerts: Alert[] = [];
  /** Every call to `alert`, delivered or not. */
  readonly alertAttempts: Alert[] = [];
  private scriptedSends: (DeliveryResult | Error)[] = [];
  private scriptedAlerts: (DeliveryResult | Error)[] = [];
  private held: Promise<void> | null = null;
  private health: DestinationHealth[] = [];

  /**
   * The next `send` calls return these results, in order (an `Error` is thrown
   * as is); then, delivery.
   */
  scriptSends(...results: (DeliveryResult | Error)[]): void {
    this.scriptedSends.push(...results);
  }

  /** The next `alert` calls return these results, in order; then, delivery. */
  scriptAlerts(...results: (DeliveryResult | Error)[]): void {
    this.scriptedAlerts.push(...results);
  }

  /** The next `healthCheck` calls return these results; then, reachable. */
  scriptHealth(...health: DestinationHealth[]): void {
    this.health.push(...health);
  }

  /** The following `healthCheck` calls return reachable: the rest of the script is dropped. */
  restoreHealth(): void {
    this.health = [];
  }

  /** Number of calls to `healthCheck`. */
  get healthChecks(): number {
    return this.healthCheckTimes.length;
  }

  /** Blocks `send` calls until the returned function is called (for concurrent calls). */
  hold(): () => void {
    let release!: () => void;
    this.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      this.held = null;
      release();
    };
  }

  async send(delivery: OutgoingDelivery): Promise<DeliveryResult> {
    this.attempts.push(delivery);
    this.attemptTimes.push(performance.now());
    if (this.held) await this.held;
    const result = this.scriptedSends.shift() ?? {
      status: 'delivered',
      externalUrl: `https://destination.test/deliveries/${delivery.deliveryId}`,
    };
    if (result instanceof Error) throw result;
    if (result.status === 'delivered') this.deliveries.push(delivery);
    return result;
  }

  /** Answers from the same script as `send`: `scriptSends` also fails Incident Deliveries. */
  async deliverIncident(delivery: OutgoingIncidentDelivery): Promise<DeliveryResult> {
    this.incidentAttempts.push(delivery);
    if (this.held) await this.held;
    const result = this.scriptedSends.shift() ?? {
      status: 'delivered',
      externalUrl: `https://destination.test/incidents/${delivery.deliveryId}`,
    };
    if (result instanceof Error) throw result;
    if (result.status === 'delivered') this.incidents.push(delivery);
    return result;
  }

  /** Answers from the same script as `send`; delivered, it returns the opening's URL. */
  async closeIncident(closing: OutgoingIncidentClosing): Promise<DeliveryResult> {
    this.closingAttempts.push(closing);
    if (this.held) await this.held;
    const result = this.scriptedSends.shift() ?? {
      status: 'delivered',
      externalUrl: closing.opening.externalUrl,
    };
    if (result instanceof Error) throw result;
    if (result.status === 'delivered') this.closings.push(closing);
    return result;
  }

  /** Answers from the same script as `send`. */
  async summarizeHeld(summary: OutgoingHeldSummary): Promise<DeliveryResult> {
    const result = this.scriptedSends.shift() ?? { status: 'delivered', externalUrl: null };
    if (result instanceof Error) throw result;
    if (result.status === 'delivered') this.heldSummaries.push(summary);
    return result;
  }

  async alert(alert: Alert): Promise<DeliveryResult> {
    this.alertAttempts.push(alert);
    const result = this.scriptedAlerts.shift() ?? { status: 'delivered', externalUrl: null };
    if (result instanceof Error) throw result;
    if (result.status === 'delivered') this.alerts.push(alert);
    return result;
  }

  async healthCheck(): Promise<DestinationHealth> {
    this.healthCheckTimes.push(performance.now());
    return this.health.shift() ?? { reachable: true };
  }
}

/** Shorthand: `fake.scriptSends(failure('transient'))`. */
export const failure = (
  failureClass: FailureClass,
  message = `simulated ${failureClass} failure`,
): DeliveryResult => ({
  status: 'failed',
  failureClass,
  message,
});
