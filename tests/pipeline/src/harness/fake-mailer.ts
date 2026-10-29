import type { DeliveryResult, DestinationHealth, MailMessage, Mailer } from '@nudge/core';

/**
 * The Instance's SMTP server, stubbed: every message is kept in `sent`, in order.
 * `next` sets the result of the following sends (delivered by default).
 */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  next: DeliveryResult = { status: 'delivered', externalUrl: null };

  send(message: MailMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    return Promise.resolve(this.next);
  }

  verify(): Promise<DestinationHealth> {
    return Promise.resolve(
      this.next.status === 'delivered'
        ? { reachable: true }
        : { reachable: false, failureClass: this.next.failureClass, message: this.next.message },
    );
  }
}
