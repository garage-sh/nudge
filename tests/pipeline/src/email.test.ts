import type { DestinationWithGeneratedSecrets, InstanceSmtpView } from '@nudge/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMBER,
  startPipeline,
  type DashboardClient,
  type Pipeline,
} from './harness/index.js';

/** The real email adapter, against a stubbed SMTP server (`pipeline.mailer`). */
describe('Email Destination and SMTP settings end to end', () => {
  let pipeline: Pipeline;
  let member: DashboardClient;

  beforeAll(async () => {
    pipeline = await startPipeline({ destinations: 'real' });
    member = await pipeline.signIn();
  });

  afterAll(async () => {
    await pipeline?.stop();
  });

  const SMTP = {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'nudge',
    password: 'smtp-secret',
    fromAddress: 'nudge@example.com',
    fromName: 'nudge',
  };

  it('the SMTP server is saved without ever returning its password', async () => {
    expect((await member.get('/api/instance/smtp')).body).toEqual({ smtp: null });

    const saved = await member.put<InstanceSmtpView>('/api/instance/smtp', SMTP);

    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'nudge',
      passwordConfigured: true,
      fromAddress: 'nudge@example.com',
      fromName: 'nudge',
    });
    expect(JSON.stringify((await member.get('/api/instance/smtp')).body)).not.toContain(
      'smtp-secret',
    );
  });

  it('the password is kept for the same account, and dropped when the host changes', async () => {
    const { password: _password, ...withoutPassword } = SMTP;
    await member.put('/api/instance/smtp', SMTP);

    const same = await member.put<InstanceSmtpView>('/api/instance/smtp', withoutPassword);
    expect(same.body.passwordConfigured).toBe(true);

    const moved = await member.put<InstanceSmtpView>('/api/instance/smtp', {
      ...withoutPassword,
      host: 'elsewhere.example.com',
    });
    expect(moved.body.passwordConfigured).toBe(false);
  });

  it('a display name with a line break is refused', async () => {
    const refused = await member.put('/api/instance/smtp', {
      ...SMTP,
      fromName: 'nudge\r\nBcc: someone@example.com',
    });
    expect(refused.status).toBe(400);
  });

  it('"send a test email" goes to the signed-in Member', async () => {
    await member.put('/api/instance/smtp', SMTP);

    const result = await member.post('/api/instance/smtp/test');

    expect(result.body).toEqual({ status: 'delivered', externalUrl: null });
    expect(pipeline.mailer.sent.at(-1)).toMatchObject({
      to: [DEFAULT_MEMBER.email],
      subject: '[nudge] Test email',
    });
  });

  it('a Triaged Feedback is emailed to the recipients, its text escaped', async () => {
    const { project, secretKey } = await pipeline.createProject({ name: 'Shop' });
    const creation = await member.post<DestinationWithGeneratedSecrets>(
      `/api/projects/${project.id}/destinations`,
      {
        type: 'email',
        name: 'Support inbox',
        config: { recipients: ['Support@Example.com', 'support@example.com', 'qa@example.com'] },
      },
    );
    expect(creation.status).toBe(201);
    expect(creation.body.destination.config).toEqual({
      recipients: ['support@example.com', 'qa@example.com'],
    });
    pipeline.judge.script({ type: 'bug', severity: 'major' });

    const response = await pipeline.postFeedback(secretKey, {
      text: '<script>alert(1)</script> the cart crashes',
    });
    const { id } = (await response.json()) as { id: string };
    await pipeline.waitForFeedback(id, (r) => r.deliveries.some((e) => e.status === 'delivered'));

    const mail = pipeline.mailer.sent.find((sent) => sent.html.includes(id));
    expect(mail).toMatchObject({
      to: ['support@example.com', 'qa@example.com'],
      subject: '[nudge] Bug · Shop · <script>alert(1)</script> the cart crashes',
    });
    expect(mail!.html).not.toContain('<script>');
    expect(mail!.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; the cart crashes');
    expect(mail!.text).toContain('<script>alert(1)</script> the cart crashes');
  });

  it('an email Destination with no valid address is refused', async () => {
    const { project } = await pipeline.createProject({ name: 'Refused' });
    const refused = await member.post(`/api/projects/${project.id}/destinations`, {
      type: 'email',
      name: 'Nobody',
      config: { recipients: ['not an address'] },
    });
    expect(refused.status).toBe(400);
  });
});
