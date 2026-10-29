import { Inject, Injectable } from '@nestjs/common';
import { buildDashboardUrl, type CaptureToDispatch, type OutgoingDelivery } from '@nudge/core';
import { feedbacks, type captures, type Db, type DeliverySubject } from '@nudge/database';
import { eq } from 'drizzle-orm';
import type { PreparedDelivery, SubjectDispatcher } from './delivery-subject.js';
import type { WorkerOptions } from './options.js';
import { DB, OPTIONS } from './tokens.js';

/** Dispatch of a Delivery whose subject is a Feedback: it goes out with its Verdict. */
@Injectable()
export class FeedbackSubject implements SubjectDispatcher {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(OPTIONS) private readonly options: WorkerOptions,
  ) {}

  async prepare(deliveryId: string, { id }: DeliverySubject): Promise<PreparedDelivery> {
    const feedback = await this.db.query.feedbacks.findFirst({
      where: eq(feedbacks.id, id),
      with: { project: true, verdict: true, capture: true },
    });
    if (!feedback)
      return { status: 'ignored', reason: `Delivery ${deliveryId} without a Feedback` };
    const { verdict } = feedback;
    if (!verdict) {
      return { status: 'ignored', reason: `Delivery ${deliveryId} without a Verdict` };
    }
    // Deliveries are only created for a Triaged or Dispatched Feedback: one of a
    // Feedback that is not (any more) is never sent.
    if (feedback.state !== 'triaged' && feedback.state !== 'dispatched') {
      return {
        status: 'not_dispatchable',
        reason: `Feedback ${feedback.state}, not dispatchable`,
      };
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
        resolvedType: verdict.resolvedType,
        severity: verdict.severity,
        uncertain: verdict.uncertain,
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
    return {
      status: 'ready',
      send: (adapter) => adapter.send(outgoing),
      failedInternally: () => captureUnreadable,
    };
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
