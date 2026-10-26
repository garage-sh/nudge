import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISPATCH_JOB,
  releaseJobId,
  type DestinationAdapterResolver,
  type DispatchJob,
  type DeliveryResult,
  type DestinationHealth,
  type SecretCipher,
} from '@nudge/core';
import { destinations, deliveries, toConfiguredDestination, type Db } from '@nudge/database';
import { errorMessage } from '@nudge/shared';
import type { Queue } from 'bullmq';
import { and, eq, lte, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_SUSPENSION,
  type SuspensionOptions,
  type Suspension,
  type OnSuspension,
  type WorkerOptions,
} from './options.js';
import { withTimeout } from './timeout.js';
import {
  DB,
  DESTINATION_ADAPTER_RESOLVER,
  DISPATCH_QUEUE_TOKEN,
  OPTIONS,
  SECRET_CIPHER,
  ON_SUSPENSION,
} from './tokens.js';

type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0];
type Failure = Extract<DeliveryResult, { status: 'failed' }>;

/** What a Delivery becomes after a failure. */
export type FailureOutcome = 'held' | 'retry' | 'failed';

/** Beyond this, an unanswered probe counts as unreachable. */
const PROBE_TIMEOUT_MS = 10_000;

const reason = (failureClass: string, message: string) => `${failureClass}: ${message}`;

/** One specific Delivery, as long as it awaits delivery. */
const pendingDelivery = (deliveryId: string) =>
  and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'pending'));

/**
 * Outcome of Deliveries and Suspension of Destinations. Every transition is an UPDATE
 * conditional on the current state: two workers failing at the same time suspend the
 * Destination only once, a probe does not reactivate a Destination already
 * reactivated, and a Delivery only changes status from the one that was read.
 *
 * - `transient`: one more consecutive failure; at the threshold, the Destination is Suspended;
 * - `auth`: the Destination is Suspended at once;
 * - `permanent`: the Delivery fails; the Destination answered, the streak starts over.
 *
 * Every outcome releases the Delivery's claim (`DispatchProcessor`).
 *
 * The Delivery of a Suspended Destination is held, without an outgoing call. The held
 * Deliveries of an active Destination are queued again on every probe run, until their
 * job picks them up: an interrupted release (restart, Redis unavailable) is caught up
 * on the next run.
 */
@Injectable()
export class SuspensionService {
  private readonly logger = new Logger(SuspensionService.name);
  private readonly policy: SuspensionOptions;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    @Inject(DISPATCH_QUEUE_TOKEN) private readonly dispatchQueue: Queue<DispatchJob>,
    @Inject(ON_SUSPENSION) private readonly onSuspension: OnSuspension,
    @Inject(OPTIONS) options: WorkerOptions,
  ) {
    this.policy = options.suspension ?? DEFAULT_SUSPENSION;
  }

  /** Holds a pending Delivery, without an outgoing call (its Destination is Suspended). */
  async hold(deliveryId: string): Promise<void> {
    await this.db
      .update(deliveries)
      .set({ status: 'held', heldAt: sql`now()` })
      .where(pendingDelivery(deliveryId));
  }

  /**
   * Resumes a held Delivery whose Destination is active: it goes back to pending.
   * Returns false if it was no longer held (another job already resumed it).
   */
  async resume(deliveryId: string): Promise<boolean> {
    const resumed = await this.db
      .update(deliveries)
      .set({ status: 'pending', heldAt: null })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'held')))
      .returning({ id: deliveries.id });
    return resumed.length > 0;
  }

  /**
   * A release job that arrived when the Destination is Suspended again: the hold starts
   * over, and the next release will have a new job id.
   */
  async extendHold(deliveryId: string): Promise<void> {
    await this.db
      .update(deliveries)
      .set({ heldAt: sql`now()` })
      .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'held')));
  }

  /** The Delivery is delivered; its Destination's consecutive failure streak starts over. */
  async afterDelivery(
    delivery: { readonly id: string; readonly destinationId: string },
    externalUrl: string | null,
  ): Promise<void> {
    await this.db
      .update(deliveries)
      .set({
        status: 'delivered',
        externalUrl,
        attempts: sql`${deliveries.attempts} + 1`,
        lastError: null,
        claimedAt: null,
      })
      .where(pendingDelivery(delivery.id));
    await this.resetFailures(delivery.destinationId);
  }

  /**
   * Records the failure of a pending Delivery and returns what it becomes: held (its
   * Destination is, or just became, Suspended), to retry (transient below the
   * threshold) or failed (permanent, or transient on the last attempt).
   *
   * `lastAttempt`: BullMQ will not run the job again. `internal`: the failure comes from
   * nudge and not from the target (D25); it is retried but does not count toward Suspension.
   */
  async afterFailure(
    delivery: { readonly id: string; readonly destinationId: string },
    result: Failure,
    { lastAttempt, internal }: { lastAttempt: boolean; internal: boolean },
  ): Promise<FailureOutcome> {
    const attempts = sql`${deliveries.attempts} + 1`;
    const lastError = reason(result.failureClass, result.message);

    if (result.failureClass === 'permanent') {
      await this.db
        .update(deliveries)
        .set({ status: 'failed', attempts, lastError, claimedAt: null })
        .where(pendingDelivery(delivery.id));
      await this.resetFailures(delivery.destinationId);
      return 'failed';
    }
    const { failureClass, message } = result;

    const { outcome, suspension } = await this.db.transaction(async (tx) => {
      // Lock until commit: concurrent failures are counted one after the other.
      const [destination] = await tx
        .select({ state: destinations.state })
        .from(destinations)
        .where(eq(destinations.id, delivery.destinationId))
        .for('update');
      let suspension: Suspension | null = null;
      if (destination?.state === 'active' && !internal) {
        const thresholdReached =
          failureClass === 'transient' &&
          (await this.countFailure(tx, delivery.destinationId)) >= this.policy.failureThreshold;
        if (failureClass === 'auth' || thresholdReached) {
          suspension = await this.suspend(tx, delivery.destinationId, failureClass, message);
        }
      }

      const suspended = destination?.state === 'suspended' || suspension !== null;
      if (suspended) {
        await tx
          .update(deliveries)
          .set({ status: 'held', heldAt: sql`now()`, attempts, lastError, claimedAt: null })
          .where(pendingDelivery(delivery.id));
        return { outcome: 'held' as const, suspension };
      }
      if (lastAttempt) {
        await tx
          .update(deliveries)
          .set({ status: 'failed', attempts, lastError, claimedAt: null })
          .where(pendingDelivery(delivery.id));
        return { outcome: 'failed' as const, suspension };
      }
      // Still pending: released for the job's next attempt.
      await tx
        .update(deliveries)
        .set({ attempts, lastError, claimedAt: null })
        .where(pendingDelivery(delivery.id));
      return { outcome: 'retry' as const, suspension };
    });

    if (suspension) await this.notify(suspension);
    return outcome;
  }

  /**
   * Scheduled task: probes each Suspended Destination whose cooldown has elapsed and
   * reactivates those that answer, then queues again the held Deliveries of every
   * active Destination.
   */
  async probe(): Promise<void> {
    // Reserve the probe by pushing back the next one: two concurrent runs do not probe
    // the same Destination twice.
    const toProbe = await this.db
      .update(destinations)
      .set({ nextProbeAt: this.cooldownEnd() })
      .where(and(eq(destinations.state, 'suspended'), lte(destinations.nextProbeAt, sql`now()`)))
      .returning();
    for (const destination of toProbe) {
      const health = await this.health(destination);
      if (!health.reachable) {
        this.logger.warn(
          `Destination ${destination.id} still unreachable (${reason(health.failureClass, health.message)}): stays Suspended`,
        );
        continue;
      }
      const [reactivated] = await this.db
        .update(destinations)
        .set({
          state: 'active',
          consecutiveFailures: 0,
          suspendedAt: null,
          suspensionReason: null,
          nextProbeAt: null,
        })
        .where(and(eq(destinations.id, destination.id), eq(destinations.state, 'suspended')))
        .returning({ id: destinations.id });
      if (reactivated) this.logger.log(`Destination ${destination.id} reachable: active again`);
    }
    await this.release();
  }

  /**
   * The only transition of a Destination to Suspended: conditional on `active`, it
   * returns `null` if it already was. The caller notifies `ON_SUSPENSION` after the commit.
   */
  private async suspend(
    tx: Transaction,
    destinationId: string,
    failureClass: Suspension['failureClass'],
    message: string,
  ): Promise<Suspension | null> {
    const [suspended] = await tx
      .update(destinations)
      .set({
        state: 'suspended',
        suspendedAt: sql`now()`,
        suspensionReason: reason(failureClass, message),
        nextProbeAt: this.cooldownEnd(),
      })
      .where(and(eq(destinations.id, destinationId), eq(destinations.state, 'active')))
      .returning({
        destinationId: destinations.id,
        projectId: destinations.projectId,
        name: destinations.name,
        suspendedAt: destinations.suspendedAt,
      });
    if (!suspended?.suspendedAt) return null;
    return { ...suspended, suspendedAt: suspended.suspendedAt, failureClass, message };
  }

  private async notify(suspension: Suspension): Promise<void> {
    this.logger.warn(
      `Destination ${suspension.destinationId} Suspended (${reason(suspension.failureClass, suspension.message)})`,
    );
    try {
      await this.onSuspension(suspension);
    } catch (error) {
      this.logger.error(
        `Suspension of Destination ${suspension.destinationId} not reported: ${String(error)}`,
      );
    }
  }

  /**
   * Queues again the held Deliveries of the active Destinations, without modifying
   * them: the job resumes them itself. The job id derives from the current hold, so
   * that a later run does not double a job still waiting.
   */
  private async release(): Promise<void> {
    const held = await this.db
      .select({ id: deliveries.id, heldAt: deliveries.heldAt })
      .from(deliveries)
      .innerJoin(destinations, eq(destinations.id, deliveries.destinationId))
      .where(and(eq(deliveries.status, 'held'), eq(destinations.state, 'active')));
    if (held.length === 0) return;
    await this.dispatchQueue.addBulk(
      held.map(({ id, heldAt }) => ({
        name: DISPATCH_JOB,
        data: { deliveryId: id },
        opts: { jobId: releaseJobId(id, heldAt) },
      })),
    );
  }

  /** One more transient failure; returns the current streak. */
  private async countFailure(tx: Transaction, destinationId: string): Promise<number> {
    const [destination] = await tx
      .update(destinations)
      .set({ consecutiveFailures: sql`${destinations.consecutiveFailures} + 1` })
      .where(eq(destinations.id, destinationId))
      .returning({ consecutiveFailures: destinations.consecutiveFailures });
    return destination?.consecutiveFailures ?? 0;
  }

  private async health(destination: typeof destinations.$inferSelect): Promise<DestinationHealth> {
    try {
      const adapter = this.resolveDestinationAdapter(
        toConfiguredDestination(destination, this.cipher),
      );
      return await withTimeout(
        PROBE_TIMEOUT_MS,
        () => new Error(`no response after ${PROBE_TIMEOUT_MS} ms`),
        () => adapter.healthCheck(),
      );
    } catch (error) {
      return { reachable: false, failureClass: 'transient', message: errorMessage(error) };
    }
  }

  private async resetFailures(destinationId: string): Promise<void> {
    await this.db
      .update(destinations)
      .set({ consecutiveFailures: 0 })
      .where(and(eq(destinations.id, destinationId), ne(destinations.consecutiveFailures, 0)));
  }

  private cooldownEnd() {
    return sql`now() + ${this.policy.cooldownMs} * interval '1 millisecond'`;
  }
}
