import type {
  ConfiguredDestination,
  DeliveryResult,
  MailMessage,
  Mailer,
  OutgoingDelivery,
  SmtpSettings,
} from '@nudge/core';
import { describe, expect, it } from 'vitest';
import { emailAdapter } from './email.js';
import { smtpFailure, smtpMailer } from './smtp.js';
import { HELD_SUMMARY, IN_REVIEW_ALERT, STORM_ALERT, SUSPENSION_ALERT } from './test/alerts.js';
import { incidentClosing, incidentOpenedThenClosed, incidentOpening } from './test/incidents.js';

const DESTINATION: ConfiguredDestination = {
  id: '6f1c2a40-0000-4000-8000-000000000001',
  projectId: '6f1c2a40-0000-4000-8000-000000000002',
  name: 'Support inbox',
  type: 'email',
  config: { recipients: ['support@shop.test'] },
  secrets: {},
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const DELIVERY: OutgoingDelivery = {
  deliveryId: '6f1c2a40-0000-4000-8000-000000000003',
  isTest: false,
  project: { id: DESTINATION.projectId!, name: 'Shop <b>' },
  feedback: {
    id: '6f1c2a40-0000-4000-8000-000000000004',
    text: '<img src=x onerror=alert(1)>\nThe cart crashes',
    source: 'widget',
    resolvedType: 'bug',
    severity: 'major',
    uncertain: true,
    author: { id: 'u-42', email: 'ada@client.test', name: 'Ada', trust: 'attested' },
    context: { url: 'https://shop.test/cart"><script>', viewport: { width: 1440, height: 900 } },
    capture: { contentType: 'image/png', bytes: PNG.length, read: () => Promise.resolve(PNG) },
    receivedAt: new Date('2026-10-24T09:29:58.000Z'),
    dashboardUrl: 'https://nudge.example/feedbacks/6f1c2a40-0000-4000-8000-000000000004',
  },
};

/** A mailer that keeps what it is asked to send. */
function recordingMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    send: (message) => {
      sent.push(message);
      return Promise.resolve({ status: 'delivered', externalUrl: null });
    },
    verify: () => Promise.resolve({ reachable: true }),
  };
}

describe('email adapter', () => {
  it('sends the Feedback to the recipients, every external text escaped', async () => {
    const mailer = recordingMailer();

    const result = await emailAdapter(DESTINATION, { mailer }).send(DELIVERY);

    expect(result).toEqual({ status: 'delivered', externalUrl: null });
    const [mail] = mailer.sent;
    expect(mail!.to).toEqual(['support@shop.test']);
    expect(mail!.subject).toBe('[nudge] Bug · Shop <b> · <img src=x onerror=alert(1)>');
    expect(mail!.html).not.toMatch(/<img|<script|<b>/);
    expect(mail!.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(mail!.html).toContain('href="https://nudge.example/feedbacks/');
    expect(mail!.text).toContain('Bug · Major · Uncertain verdict');
  });

  it('attaches the Capture', async () => {
    const mailer = recordingMailer();

    await emailAdapter(DESTINATION, { mailer }).send(DELIVERY);

    expect(mailer.sent[0]!.attachments).toEqual([
      {
        filename: `capture-${DELIVERY.feedback.id}.png`,
        contentType: 'image/png',
        content: PNG,
      },
    ]);
  });

  it('sends without attachment when storage no longer has the Capture', async () => {
    const mailer = recordingMailer();
    const gone = {
      ...DELIVERY,
      feedback: {
        ...DELIVERY.feedback,
        capture: { ...DELIVERY.feedback.capture!, read: () => Promise.resolve(null) },
      },
    };

    await emailAdapter(DESTINATION, { mailer }).send(gone);

    expect(mailer.sent[0]!.attachments).toBeUndefined();
  });

  it('sends the alerts, names and refusals escaped', async () => {
    const mailer = recordingMailer();
    const adapter = emailAdapter(DESTINATION, { mailer });

    await adapter.alert(IN_REVIEW_ALERT);
    await adapter.alert(SUSPENSION_ALERT);

    expect(mailer.sent.map((mail) => mail.subject)).toEqual([
      '[nudge] Feedback in review · @everyone *Shop*',
      '[nudge] Destination suspended · Linear [prod](https://trap.test)',
    ]);
    expect(mailer.sent[1]!.html).toContain('HTTP 401: &lt;!channel&gt; @here `token` rejected');
  });

  it('sends the summary of Held Incidents, the Project name escaped, linking to them', async () => {
    const mailer = recordingMailer();

    await emailAdapter(DESTINATION, { mailer }).summarizeHeld(HELD_SUMMARY);

    const [mail] = mailer.sent;
    expect(mail!.to).toEqual(['support@shop.test']);
    expect(mail!.subject).toBe('[nudge] Incidents held · @everyone *Shop* <b>');
    expect(mail!.html).toContain('@everyone *Shop* &lt;b&gt;');
    expect(mail!.html).not.toContain('<b>');
    expect(mail!.html).toContain(HELD_SUMMARY.dashboardUrl!.replaceAll('&', '&amp;'));
    expect(mail!.text).toContain('37 Incidents were held');
  });

  it('names the Incident storm alert', async () => {
    const mailer = recordingMailer();

    await emailAdapter(DESTINATION, { mailer }).alert(STORM_ALERT);

    expect(mailer.sent[0]!.subject).toBe('[nudge] Incident storm · @everyone *Shop*');
    expect(mailer.sent[0]!.text).toContain('Incident storm');
  });

  describe('Incidents', () => {
    const OPENING = incidentOpening(DESTINATION.projectId!);
    const CLOSING = incidentClosing(DESTINATION.projectId!, null);

    it('sends an opening mail with its own Message-ID, every external text escaped', async () => {
      const mailer = recordingMailer();

      const result = await emailAdapter(DESTINATION, { mailer }).deliverIncident(OPENING);

      expect(result).toEqual({ status: 'delivered', externalUrl: null });
      const [mail] = mailer.sent;
      expect(mail!.to).toEqual(['support@shop.test']);
      expect(mail!.subject).toBe('[nudge] Incident · Shop · @everyone <b>Payment</b> timed out');
      expect(mail!.messageId).toBe(`incident.${OPENING.deliveryId}`);
      expect(mail!.inReplyTo).toBeUndefined();
      expect(mail!.html).not.toMatch(/<b>/);
      expect(mail!.html).toContain('&lt;b&gt;Payment&lt;/b&gt;');
      expect(mail!.html).toContain(`href="${OPENING.incident.dashboardUrl}"`);
      expect(mail!.text).toContain('An Incident opened in Shop (production).');
      expect(mail!.text).toContain('Level: Error (declared)');
      expect(mail!.text).toContain('POST /charges took 30 s');
      expect(mail!.text).toContain('service: checkout\nretried: true');
    });

    it('sends the closing as a reply to the opening mail: same subject, threading headers', async () => {
      const mailer = recordingMailer();
      const adapter = emailAdapter(DESTINATION, { mailer });

      await adapter.deliverIncident(OPENING);
      expect(await adapter.closeIncident(CLOSING)).toEqual({
        status: 'delivered',
        externalUrl: null,
      });

      const [opening, closing] = mailer.sent;
      expect(closing!.subject).toBe(`Re: ${opening!.subject}`);
      expect(closing!.inReplyTo).toBe(opening!.messageId);
      expect(closing!.messageId).not.toBe(opening!.messageId);
      expect(closing!.text).toContain('An Incident of Shop was resolved by its sender.');
      expect(closing!.text).toContain('Closed: 2026-10-24T09:31:00.000Z');
    });

    it('keeps the subject of the opening even when the Level rose meanwhile', async () => {
      const mailer = recordingMailer();
      const adapter = emailAdapter(DESTINATION, { mailer });

      await adapter.deliverIncident(OPENING);
      await adapter.closeIncident({
        ...CLOSING,
        incident: { ...CLOSING.incident, level: 'critical' },
      });

      expect(mailer.sent[1]!.subject).toBe(`Re: ${mailer.sent[0]!.subject}`);
    });

    it('"opened then closed" after a suspension is a single mail, in its final state', async () => {
      const mailer = recordingMailer();

      await emailAdapter(DESTINATION, { mailer }).deliverIncident(
        incidentOpenedThenClosed(DESTINATION.projectId!),
      );

      expect(mailer.sent).toHaveLength(1);
      const [mail] = mailer.sent;
      expect(mail!.subject).toBe('[nudge] Incident · Shop · @everyone <b>Payment</b> timed out');
      expect(mail!.inReplyTo).toBeUndefined();
      expect(mail!.text).toContain('An Incident of Shop was resolved by its sender.');
    });
  });

  it('refuses a Destination without valid recipients', () => {
    expect(() =>
      emailAdapter({ ...DESTINATION, config: { recipients: [] } }, { mailer: recordingMailer() }),
    ).toThrow(/no valid recipients/);
  });
});

const SMTP: SmtpSettings = {
  host: '127.0.0.1',
  port: 2525,
  security: 'none',
  username: null,
  password: null,
  fromAddress: 'nudge@shop.test',
  fromName: 'nudge',
};

describe('smtpMailer', () => {
  it('without an SMTP server, holds the email as an auth failure', async () => {
    const mailer = smtpMailer({
      settings: () => Promise.resolve(null),
      policy: { allowedHosts: [] },
    });

    expect(await mailer.send({ to: ['a@b.test'], subject: 's', html: '', text: '' })).toEqual({
      status: 'failed',
      failureClass: 'auth',
      message: 'No SMTP server: configure one in the Instance settings',
    });
    expect(await mailer.verify()).toMatchObject({ reachable: false, failureClass: 'auth' });
  });

  it('refuses an internal host the Self-hoster did not allow', async () => {
    let built = false;
    const mailer = smtpMailer({
      settings: () => Promise.resolve(SMTP),
      policy: { allowedHosts: [] },
      createTransport: () => {
        built = true;
        throw new Error('never built');
      },
    });

    const result = (await mailer.send({
      to: ['a@b.test'],
      subject: 's',
      html: '',
      text: '',
    })) as Extract<DeliveryResult, { status: 'failed' }>;

    expect(built).toBe(false);
    expect(result).toMatchObject({ status: 'failed', failureClass: 'transient' });
    expect(result.message).toMatch(/not a public address/);
  });

  it('connects to the allowed address, with the configured security, and sends', async () => {
    const calls: { options: unknown; mail?: unknown; closed?: boolean }[] = [];
    const mailer = smtpMailer({
      settings: () =>
        Promise.resolve({ ...SMTP, security: 'starttls', username: 'u', password: 'p' }),
      policy: { allowedHosts: ['127.0.0.1'] },
      createTransport: (options) => {
        const call: (typeof calls)[number] = { options };
        calls.push(call);
        return {
          sendMail: (mail: unknown) => {
            call.mail = mail;
            return Promise.resolve({});
          },
          verify: () => Promise.resolve(true),
          close: () => {
            call.closed = true;
          },
        } as never;
      },
    });

    const result = await mailer.send({
      to: ['a@b.test'],
      subject: 'Hello',
      html: '<p>Hi</p>',
      text: 'Hi',
    });

    expect(result).toEqual({ status: 'delivered', externalUrl: null });
    expect(calls[0]).toMatchObject({
      options: {
        host: '127.0.0.1',
        port: 2525,
        secure: false,
        requireTLS: true,
        auth: { user: 'u', pass: 'p' },
        disableFileAccess: true,
        disableUrlAccess: true,
      },
      mail: {
        from: { name: 'nudge', address: 'nudge@shop.test' },
        to: ['a@b.test'],
        subject: 'Hello',
      },
      closed: true,
    });
  });
});

describe('smtpMailer threading', () => {
  async function sent(message: Partial<MailMessage>) {
    let mail: Record<string, unknown> | undefined;
    const mailer = smtpMailer({
      settings: () => Promise.resolve(SMTP),
      policy: { allowedHosts: ['127.0.0.1'] },
      createTransport: () =>
        ({
          sendMail: (sentMail: Record<string, unknown>) => {
            mail = sentMail;
            return Promise.resolve({});
          },
          verify: () => Promise.resolve(true),
          close: () => undefined,
        }) as never,
    });
    await mailer.send({ to: ['a@b.test'], subject: 's', html: '', text: '', ...message });
    return mail!;
  }

  it("qualifies the Message-ID and the reply headers with the sender's domain", async () => {
    expect(await sent({ messageId: 'incident.1.closed', inReplyTo: 'incident.1' })).toMatchObject({
      messageId: '<incident.1.closed@shop.test>',
      inReplyTo: '<incident.1@shop.test>',
      references: ['<incident.1@shop.test>'],
    });
  });

  it('leaves the Message-ID to nodemailer when the message names none', async () => {
    const mail = await sent({});

    expect(mail.messageId).toBeUndefined();
    expect(mail.inReplyTo).toBeUndefined();
    expect(mail.references).toBeUndefined();
  });
});

describe('smtpFailure', () => {
  const error = (fields: Record<string, unknown>) => Object.assign(new Error('refused'), fields);

  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'auth'],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'permanent'],
    [{ code: 'EMESSAGE' }, 'permanent'],
    [{ responseCode: 421 }, 'transient'],
    [{ code: 'ETIMEDOUT' }, 'transient'],
    [{ code: 'ECONNECTION' }, 'transient'],
  ])('%o is %s', (fields, failureClass) => {
    expect(smtpFailure(error(fields)).failureClass).toBe(failureClass);
  });
});
