import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  failureFromException,
  type DestinationAdapter,
  type DestinationAdapterResolver,
  type DispatchJob,
  type DeliveryResult,
  type SecretCipher,
} from '@nudge/core';
import {
  deliveries,
  subjectOf,
  toConfiguredDestination,
  type Db,
  type DestinationRow,
} from '@nudge/database';
import type { DeliverySubjectKind } from '@nudge/shared';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { SubjectDispatcher } from './subject-dispatcher.js';
import { FeedbackDispatcher } from './feedback-dispatcher.js';
import { IncidentDispatcher } from './incident-dispatcher.js';
import { TransientFailure } from './transient-failure.js';
import { SuspensionService } from './suspension.service.js';
import { DB, DESTINATION_ADAPTER_RESOLVER, SECRET_CIPHER } from './tokens.js';

/**
 * Beyond this, the claim of a Delivery belongs to a job that died while sending it (a
 * send lasts at most the adapter's timeout); shorter than the default sweep delay and
 * than the retries of a dispatch job, which take it over.
 */
export const DELIVERY_CLAIM_TTL_MS = 2 * 60_000;

@Injectable()
export class DispatchProcessor {
  private readonly logger = new Logger(DispatchProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DESTINATION_ADAPTER_RESOLVER)
    private readonly resolveDestinationAdapter: DestinationAdapterResolver,
    @Inject(SECRET_CIPHER) private readonly cipher: SecretCipher,
    private readonly suspension: SuspensionService,
    feedbackDispatcher: FeedbackDispatcher,
    incidentDispatcher: IncidentDispatcher,
  ) {
    this.subjects = { feedback: feedbackDispatcher, incident: incidentDispatcher };
  }

  /** What each subject of a Delivery adds to Dispatch: one dispatcher per kind. */
  private readonly subjects: Record<DeliverySubjectKind, SubjectDispatcher>;

  /**
   * `lastAttempt`: BullMQ will not run this job again; a transient failure then marks
   * the Delivery failed instead of leaving it pending without a job.
   */
  async handle({ deliveryId }: DispatchJob, { lastAttempt = false } = {}): Promise<void> {
    const delivery = await this.db.query.deliveries.findFirst({
      where: eq(deliveries.id, deliveryId),
      with: { destination: true },
    });
    if (!delivery) return;
    const { destination } = delivery;
    if (delivery.status === 'held') {
      // Release job: the Delivery goes again if its Destination is active.
      if (destination.state === 'suspended') {
        await this.suspension.extendHold(deliveryId);
        return;
      }
      if (!(await this.suspension.resume(deliveryId))) return;
    } else if (delivery.status !== 'pending') {
      return;
    } else if (destination.state === 'suspended') {
      // Suspended Destination: the Delivery is held without an outgoing call.
      await this.suspension.hold(deliveryId);
      return;
    }
    const subject = subjectOf(delivery);
    const prepared = await this.subjects[subject.kind].prepare(deliveryId, subject);
    if (prepared.status === 'ignored') {
      this.logger.error(`Delivery ${deliveryId}: ${prepared.reason}, ignored`);
      return;
    }
    if (prepared.status === 'not_dispatchable') {
      this.logger.error(`Delivery ${deliveryId}: ${prepared.reason}, not sent`);
      await this.db
        .update(deliveries)
        .set({ status: 'failed', lastError: `permanent: ${prepared.reason}`, claimedAt: null })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'pending')));
      return;
    }
    if (!(await this.claim(deliveryId))) {
      // Another job is sending it: this one comes back later, in case that one died.
      throw new TransientFailure(`Delivery ${deliveryId} is being sent by another job`);
    }

    const { result, exception } = await this.send(destination, prepared.send);

    if (result.status === 'delivered') {
      await this.suspension.afterDelivery(delivery, result.externalUrl, prepared.deliveredAs);
      await prepared.delivered?.();
      return;
    }
    const outcome = await this.suspension.afterFailure(delivery, result, {
      lastAttempt,
      internal: exception || prepared.failedInternally(),
    });
    if (outcome === 'retry') throw new TransientFailure(result.message);
  }

  /**
   * Takes the pending Delivery for this job, unless another job holds it: two jobs of
   * the same Delivery never send it at the same time. The outcome of the send
   * (`SuspensionService`) releases it; the claim of a job that died while sending
   * expires after `DELIVERY_CLAIM_TTL_MS`.
   */
  private async claim(deliveryId: string): Promise<boolean> {
    const claimed = await this.db
      .update(deliveries)
      .set({ claimedAt: sql`now()` })
      .where(
        and(
          eq(deliveries.id, deliveryId),
          eq(deliveries.status, 'pending'),
          or(
            isNull(deliveries.claimedAt),
            lt(
              deliveries.claimedAt,
              sql`now() - ${DELIVERY_CLAIM_TTL_MS} * interval '1 millisecond'`,
            ),
          ),
        ),
      )
      .returning({ id: deliveries.id });
    return claimed.length > 0;
  }

  /**
   * Sends through the Destination's adapter. An exception is a transient failure that
   * comes from nudge and not from the target (D25): undecryptable secrets, unknown
   * adapter type, adapter defect — each adapter returns its target's responses and
   * network errors as a classified result.
   */
  private async send(
    destination: DestinationRow,
    send: (adapter: DestinationAdapter) => Promise<DeliveryResult>,
  ): Promise<{ result: DeliveryResult; exception: boolean }> {
    try {
      const adapter = this.resolveDestinationAdapter(
        toConfiguredDestination(destination, this.cipher),
      );
      return { result: await send(adapter), exception: false };
    } catch (error) {
      return { result: failureFromException(error), exception: true };
    }
  }
}
