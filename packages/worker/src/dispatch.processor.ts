import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  failureFromException,
  buildDashboardUrl,
  type CaptureToDispatch,
  type DestinationAdapterResolver,
  type DispatchJob,
  type OutgoingDelivery,
  type DeliveryResult,
  type SecretCipher,
} from '@nudge/core';
import {
  deliveries,
  toConfiguredDestination,
  type captures,
  type Db,
  type DestinationRow,
} from '@nudge/database';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { TransientFailure } from './transient-failure.js';
import type { WorkerOptions } from './options.js';
import { SuspensionService } from './suspension.service.js';
import { DB, DESTINATION_ADAPTER_RESOLVER, OPTIONS, SECRET_CIPHER } from './tokens.js';

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
    @Inject(OPTIONS) private readonly options: WorkerOptions,
    private readonly suspension: SuspensionService,
  ) {}

  /**
   * `lastAttempt`: BullMQ will not run this job again; a transient failure then marks
   * the Delivery failed instead of leaving it pending without a job.
   */
  async handle({ deliveryId }: DispatchJob, { lastAttempt = false } = {}): Promise<void> {
    const delivery = await this.db.query.deliveries.findFirst({
      where: eq(deliveries.id, deliveryId),
      with: {
        destination: true,
        feedback: { with: { project: true, verdict: true, capture: true } },
      },
    });
    if (!delivery) return;
    const { destination, feedback } = delivery;
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
    if (!feedback.verdict) {
      this.logger.error(`Delivery ${deliveryId} without a Verdict, ignored`);
      return;
    }
    // Deliveries are only created for a Triaged or Dispatched Feedback: one of a
    // Feedback that is not (any more) is never sent.
    if (feedback.state !== 'triaged' && feedback.state !== 'dispatched') {
      this.logger.error(`Delivery ${deliveryId} of a Feedback ${feedback.state}: not sent`);
      await this.db
        .update(deliveries)
        .set({
          status: 'failed',
          lastError: `permanent: Feedback ${feedback.state}, not dispatchable`,
          claimedAt: null,
        })
        .where(and(eq(deliveries.id, deliveryId), eq(deliveries.status, 'pending')));
      return;
    }
    if (!(await this.claim(deliveryId))) {
      // Another job is sending it: this one comes back later, in case that one died.
      throw new TransientFailure(`Delivery ${deliveryId} is being sent by another job`);
    }

    let captureUnreadable = false;
    const outgoing: OutgoingDelivery = {
      deliveryId,
      isTest: false,
      project: { id: feedback.project.id, name: feedback.project.name },
      feedback: {
        id: feedback.id,
        text: feedback.text,
        source: feedback.source,
        resolvedType: feedback.verdict.resolvedType,
        severity: feedback.verdict.severity,
        uncertain: feedback.verdict.uncertain,
        author:
          feedback.author && feedback.authorTrust
            ? { ...feedback.author, trust: feedback.authorTrust }
            : null,
        context: feedback.context,
        capture: feedback.capture
          ? this.captureToDispatch(feedback.capture, () => {
              captureUnreadable = true;
            })
          : null,
        receivedAt: feedback.createdAt,
        dashboardUrl: buildDashboardUrl(this.options.dashboardUrl, `/feedbacks/${feedback.id}`),
      },
    };

    const { result, exception } = await this.send(destination, outgoing);

    if (result.status === 'delivered') {
      await this.suspension.afterDelivery(delivery, result.externalUrl);
      return;
    }
    const outcome = await this.suspension.afterFailure(delivery, result, {
      lastAttempt,
      internal: exception || captureUnreadable,
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
    outgoing: OutgoingDelivery,
  ): Promise<{ result: DeliveryResult; exception: boolean }> {
    try {
      const adapter = this.resolveDestinationAdapter(
        toConfiguredDestination(destination, this.cipher),
      );
      return { result: await adapter.send(outgoing), exception: false };
    } catch (error) {
      return { result: failureFromException(error), exception: true };
    }
  }

  /**
   * A Feedback's Capture, read from storage only if the adapter attaches it.
   * `onFailure` reports a storage that does not return it: a failure internal to nudge.
   */
  private captureToDispatch(
    { key, contentType, bytes }: typeof captures.$inferSelect,
    onFailure: () => void,
  ): CaptureToDispatch {
    return {
      contentType,
      bytes,
      read: async () => {
        try {
          return await this.options.captureStorage.read(key);
        } catch (error) {
          onFailure();
          throw error;
        }
      },
    };
  }
}
