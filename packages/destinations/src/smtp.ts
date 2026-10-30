import { isIP } from 'node:net';
import type {
  DeliveryResult,
  DestinationHealth,
  FailureClass,
  MailMessage,
  Mailer,
  SmtpSettings,
} from '@nudge/core';
import { errorMessage } from '@nudge/shared';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { OutboundRefusedError, resolveAllowedAddress, type OutboundPolicy } from './outbound.js';
import { truncate } from './text.js';
import { EXCERPT_MAX } from './http.js';

/** SMTP server response timeout, beyond which the attempt is a transient failure. */
export const DEFAULT_SMTP_TIMEOUT_MS = 20_000;

export interface SmtpMailerOptions {
  /** The Instance's SMTP server, read again on every call; `null`: none configured. */
  readonly settings: () => Promise<SmtpSettings | null>;
  /** What the SMTP host, typed by a Member, may be besides a public address. */
  readonly policy: OutboundPolicy;
  readonly timeoutMs?: number;
  /** Builds the transport (tests: a stub instead of a real connection). */
  readonly createTransport?: (
    options: SMTPTransport.Options,
  ) => Pick<Transporter, 'sendMail' | 'verify' | 'close'>;
}

/** Without an SMTP server, every email waits: the Destination is Suspended until one is set. */
const NOT_CONFIGURED: { failureClass: FailureClass; message: string } = {
  failureClass: 'auth',
  message: 'No SMTP server: configure one in the Instance settings',
};

/**
 * A `Mailer` over the Instance's SMTP server. Each call opens its own connection,
 * to the address the outbound policy allowed (`resolveAllowedAddress`), and closes it.
 */
export function smtpMailer(options: SmtpMailerOptions): Mailer {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS;
  const build = options.createTransport ?? createTransport;

  async function connect(smtp: SmtpSettings) {
    const address = await resolveAllowedAddress(options.policy, smtp.host);
    const servername = isIP(smtp.host.replace(/^\[|\]$/g, '')) ? undefined : smtp.host;
    return build({
      host: address,
      port: smtp.port,
      secure: smtp.security === 'tls',
      requireTLS: smtp.security === 'starttls',
      ignoreTLS: smtp.security === 'none',
      // The certificate is checked against the configured name, not the resolved address.
      tls: { ...(servername ? { servername } : {}), minVersion: 'TLSv1.2' },
      ...(smtp.username ? { auth: { user: smtp.username, pass: smtp.password ?? '' } } : {}),
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
      // The message is built by nudge: no attachment path or URL is ever read.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  return {
    async send(message: MailMessage): Promise<DeliveryResult> {
      const smtp = await options.settings();
      if (!smtp) return { status: 'failed', ...NOT_CONFIGURED };
      let transport: Awaited<ReturnType<typeof connect>> | null = null;
      try {
        transport = await connect(smtp);
        await transport.sendMail({
          from: smtp.fromName
            ? { name: smtp.fromName, address: smtp.fromAddress }
            : smtp.fromAddress,
          to: [...message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...threadingHeaders(message, smtp.fromAddress),
          attachments: (message.attachments ?? []).map((attachment) => ({
            filename: attachment.filename,
            contentType: attachment.contentType,
            content: Buffer.from(attachment.content),
          })),
        });
        return { status: 'delivered', externalUrl: null };
      } catch (error) {
        return { status: 'failed', ...smtpFailure(error) };
      } finally {
        transport?.close();
      }
    },

    async verify(): Promise<DestinationHealth> {
      const smtp = await options.settings();
      if (!smtp) return { reachable: false, ...NOT_CONFIGURED };
      let transport: Awaited<ReturnType<typeof connect>> | null = null;
      try {
        transport = await connect(smtp);
        await transport.verify();
        return { reachable: true };
      } catch (error) {
        return { reachable: false, ...smtpFailure(error) };
      } finally {
        transport?.close();
      }
    },
  };
}

/**
 * The Message-ID and the reply headers of a message, qualified with the domain of the
 * sender's address (RFC 5322 §3.6.4): a client threads a reply with the message it names.
 */
function threadingHeaders({ messageId, inReplyTo }: MailMessage, fromAddress: string) {
  const domain = fromAddress.slice(fromAddress.lastIndexOf('@') + 1);
  const qualified = (local: string) => `<${local}@${domain}>`;
  return {
    ...(messageId ? { messageId: qualified(messageId) } : {}),
    ...(inReplyTo ? { inReplyTo: qualified(inReplyTo), references: [qualified(inReplyTo)] } : {}),
  };
}

/** What nodemailer adds to its errors: its code and the server's reply. */
interface SmtpError {
  readonly code?: unknown;
  readonly responseCode?: unknown;
}

/**
 * Class of an SMTP failure: refused credentials are `auth`; a 5xx reply to the message
 * (refused recipient, sender or content) is `permanent`; a 4xx reply, the network,
 * TLS and timeouts are `transient`.
 */
export function smtpFailure(error: unknown): { failureClass: FailureClass; message: string } {
  const message = truncate(errorMessage(error), EXCERPT_MAX);
  if (error instanceof OutboundRefusedError) return { failureClass: 'transient', message };
  const { code, responseCode } = (error ?? {}) as SmtpError;
  if (code === 'EAUTH' || code === 'ENOAUTH' || responseCode === 530 || responseCode === 535) {
    return { failureClass: 'auth', message };
  }
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return { failureClass: 'permanent', message };
  }
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return { failureClass: 'permanent', message };
  return { failureClass: 'transient', message };
}
