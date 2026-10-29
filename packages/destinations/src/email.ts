import type {
  ConfiguredDestination,
  DestinationAdapter,
  MailAttachment,
  Mailer,
  OutgoingDelivery,
} from '@nudge/core';
import { emailDefinition } from '@nudge/shared';
import { alertEmail, feedbackEmail } from './email-template.js';
import { incidentsNotDelivered } from './incidents.js';

export interface EmailOptions {
  /** The Instance's SMTP server (`smtpMailer`). */
  readonly mailer: Mailer;
}

/**
 * Email: one message per Feedback to the Destination's recipients, through the
 * Instance's SMTP server. The Capture travels as an attachment. Nothing is created
 * on the other side: a Delivery has no link.
 */
export function emailAdapter(
  destination: ConfiguredDestination,
  { mailer }: EmailOptions,
): DestinationAdapter {
  const parsed = emailDefinition.config.safeParse(destination.config);
  if (!parsed.success) throw new Error(`Email ${destination.id} has no valid recipients`);
  const { recipients } = parsed.data;

  return {
    async send(delivery) {
      const message = feedbackEmail(delivery, recipients);
      const capture = await captureAttachment(delivery);
      return mailer.send(capture ? { ...message, attachments: [capture] } : message);
    },
    deliverIncident: () => incidentsNotDelivered('Email'),
    closeIncident: () => incidentsNotDelivered('Email'),
    alert: (alert) => mailer.send(alertEmail(alert, recipients)),
    /** Connects and authenticates to the SMTP server, without sending anything. */
    healthCheck: () => mailer.verify(),
  };
}

/** The Capture as an attachment; none when storage no longer has it (throws if unreachable). */
async function captureAttachment({ feedback }: OutgoingDelivery): Promise<MailAttachment | null> {
  if (!feedback.capture) return null;
  const content = await feedback.capture.read();
  if (!content) return null;
  const extension = feedback.capture.contentType === 'image/png' ? 'png' : 'jpg';
  return {
    filename: `capture-${feedback.id}.${extension}`,
    contentType: feedback.capture.contentType,
    content,
  };
}
