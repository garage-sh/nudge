import type { SmtpSecurity } from '@nudge/shared';
import type { DeliveryResult, DestinationHealth } from './destination.js';

/**
 * Mail port: the Instance's SMTP server, through which the email Destination sends.
 * The server belongs to the Instance (Settings), not to a Destination: every email
 * Destination and the "send a test email" button share it.
 */

/** The Instance's SMTP server, password decrypted. */
export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly security: SmtpSecurity;
  readonly username: string | null;
  readonly password: string | null;
  readonly fromAddress: string;
  readonly fromName: string | null;
}

export interface MailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

/** A message ready to send: the adapter has already encoded every external text. */
export interface MailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly html: string;
  /** The plain-text alternative, for clients that do not render HTML. */
  readonly text: string;
  readonly attachments?: readonly MailAttachment[];
  /**
   * The local part of this message's Message-ID, which the mailer qualifies with the
   * sender's domain; absent, the mailer makes one up. A reply names it in `inReplyTo`.
   */
  readonly messageId?: string;
  /** The local part of the Message-ID this message replies to: the mail clients thread them. */
  readonly inReplyTo?: string;
}

export interface Mailer {
  /**
   * Sends through the SMTP server: refused credentials and an unconfigured server are
   * `auth` (the Destination is Suspended until it works again), a refused recipient is
   * `permanent`, the rest `transient`.
   */
  send(message: MailMessage): Promise<DeliveryResult>;
  /** Connects and authenticates without sending anything. */
  verify(): Promise<DestinationHealth>;
}
