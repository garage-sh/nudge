import type { DeliveryResult, DestinationAdapter } from '@nudge/core';
import type { DeliverySubject } from '@nudge/database';

/** What a Delivery's subject makes of it, before any outgoing call. */
export type PreparedDelivery =
  /** Nothing to send and nothing to record: the inconsistency is logged. */
  | { readonly status: 'ignored'; readonly reason: string }
  /** The subject may not be delivered (any more): the Delivery fails for good. */
  | { readonly status: 'not_dispatchable'; readonly reason: string }
  | {
      readonly status: 'ready';
      /** Sends the subject through the Destination's adapter. */
      send(adapter: DestinationAdapter): Promise<DeliveryResult>;
      /**
       * After `send`: a failure came from nudge and not from the target (D25), such as
       * an unreadable Capture; it is retried but does not count toward Suspension.
       */
      failedInternally(): boolean;
    };

/**
 * The part of Dispatch that depends on what a Delivery delivers: reading the subject,
 * deciding whether it may go out, and the adapter operation that sends it. Everything
 * else (claim, hold and release while Suspended, outcome, replay) is the same for every
 * subject and lives in `DispatchProcessor` and `SuspensionService`.
 */
export interface SubjectDispatcher {
  prepare(deliveryId: string, subject: DeliverySubject): Promise<PreparedDelivery>;
}
