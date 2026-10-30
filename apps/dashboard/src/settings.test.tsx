import type { InstanceJudgeView, InstanceSmtpView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const NO_JUDGE: InstanceJudgeView = {
  provider: null,
  model: null,
  baseUrl: null,
  keyConfigured: false,
};

const NO_ALERT_DESTINATION = { status: 200, body: { destination: null } };

const saved = (body: unknown) => ({
  status: 200,
  body: { ...NO_JUDGE, ...(body as object), keyConfigured: true },
});

const instanceRoutes = (judge: InstanceJudgeView = NO_JUDGE) => ({
  'GET /api/session': SIGNED_IN,
  'GET /api/instance/retention': { status: 200, body: { days: null } },
  'GET /api/instance/alert-destination': NO_ALERT_DESTINATION,
  'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
  'GET /api/instance/judge': { status: 200, body: judge },
});

describe('Instance settings: Judge', () => {
  it('without a chosen Judge, announces degraded mode', async () => {
    fakeApi(instanceRoutes());
    renderDashboard('/settings');

    expect(await screen.findByRole('heading', { name: 'Judge' })).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'None (degraded mode)', selected: true }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('offers providers, not a model: the model is picked at each one', async () => {
    fakeApi(instanceRoutes());
    renderDashboard('/settings');

    const provider = await screen.findByLabelText('Provider');
    expect(
      within(provider)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['None (degraded mode)', 'TypeSafe', 'OpenRouter', 'Your server (Decisions API)']);
    await userEvent.selectOptions(provider, 'self_hosted');
    expect(screen.getByText(/decision model of your choice/)).toBeTruthy();
    expect(screen.getByLabelText('Model')).toBeTruthy();
  });

  it('chooses OpenRouter with a key, sent once and never shown again', async () => {
    const api = fakeApi({ ...instanceRoutes(), 'PUT /api/instance/judge': saved });
    renderDashboard('/settings');

    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'openrouter');
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(screen.getByLabelText('Model').getAttribute('placeholder')).toBe(
      'perplexity/pplx-decider-v1.2',
    );
    await userEvent.type(key, 'sk-or-v1-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save Judge' }));

    expect(await screen.findByText(/Saved/)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/judge')?.body).toEqual({
      provider: 'openrouter',
      model: null,
      baseUrl: null,
      apiKey: 'sk-or-v1-secret',
    });
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/A key is saved/)).toBeTruthy();
  });

  it('keeps the saved key when the field stays empty', async () => {
    const api = fakeApi({
      ...instanceRoutes({ ...NO_JUDGE, provider: 'typesafe', keyConfigured: true }),
      'PUT /api/instance/judge': saved,
    });
    renderDashboard('/settings');

    await userEvent.type(await screen.findByLabelText('Model'), 'jev-1.14.0');
    await userEvent.click(screen.getByRole('button', { name: 'Save Judge' }));

    await screen.findByText(/Saved/);
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/judge')?.body).toEqual({
      provider: 'typesafe',
      model: 'jev-1.14.0',
      baseUrl: null,
    });
  });

  it('self-hosted: sends the server URL, and shows a refusal from the API', async () => {
    const api = fakeApi({
      ...instanceRoutes(),
      'PUT /api/instance/judge': {
        status: 400,
        body: {
          error: 'invalid_request',
          details: [{ path: 'baseUrl', message: 'http(s) URL expected' }],
        },
      },
    });
    renderDashboard('/settings');

    await userEvent.selectOptions(await screen.findByLabelText('Provider'), 'self_hosted');
    const url = screen.getByLabelText('Server URL') as HTMLInputElement;
    expect(url.required).toBe(true);
    await userEvent.type(url, 'http://decider:8080');
    await userEvent.click(screen.getByRole('button', { name: 'Save Judge' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/http\(s\) URL expected/);
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/judge')?.body).toEqual({
      provider: 'self_hosted',
      model: null,
      baseUrl: 'http://decider:8080',
    });
  });

  it('goes back to degraded mode by removing the Judge', async () => {
    const api = fakeApi({
      ...instanceRoutes({ ...NO_JUDGE, provider: 'typesafe', keyConfigured: true }),
      'PUT /api/instance/judge': { status: 200, body: NO_JUDGE },
    });
    renderDashboard('/settings');

    await userEvent.selectOptions(await screen.findByLabelText('Provider'), '');
    await userEvent.click(screen.getByRole('button', { name: 'Save Judge' }));

    await screen.findByText(/Saved/);
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/judge')?.body).toEqual({
      provider: null,
    });
  });
});

describe('Instance settings: retention', () => {
  const routes = (days: number | null) => ({
    'GET /api/session': SIGNED_IN,
    'GET /api/instance/judge': { status: 200, body: NO_JUDGE },
    'GET /api/instance/alert-destination': NO_ALERT_DESTINATION,
    'GET /api/instance/smtp': { status: 200, body: { smtp: null } },
    'GET /api/instance/retention': { status: 200, body: { days } },
    'PUT /api/instance/retention': (body: unknown) => ({ status: 200, body }),
  });

  it('unlimited by default, sets a period in days', async () => {
    const api = fakeApi(routes(null));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Retention' });
    expect(panel.textContent).toMatch(/Unlimited/);
    const period = within(panel).getByLabelText('Retention period (days)') as HTMLInputElement;
    expect(period.value).toBe('');
    await userEvent.type(period, '90');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save retention' }));
    // Going from unlimited to a period erases Feedback: confirmation first.
    expect(within(panel).getByRole('group').textContent).toMatch(
      /older than 90 days .*Incidents last seen more than 90 days ago.* permanently erased/,
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));

    expect(await within(panel).findByText(/Saved/)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/retention')?.body).toEqual({
      days: 90,
    });
    expect(panel.textContent).toMatch(/older than 90 days is erased automatically/);
    expect(panel.textContent).toMatch(/Incidents last seen more than 90 days ago/);
  });

  it('goes back to unlimited retention by clearing the field', async () => {
    const api = fakeApi(routes(30));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Retention' });
    const period = within(panel).getByLabelText('Retention period (days)') as HTMLInputElement;
    expect(period.value).toBe('30');
    await userEvent.clear(period);
    await userEvent.click(within(panel).getByRole('button', { name: 'Save retention' }));

    expect(await within(panel).findByText(/Saved/)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/retention')?.body).toEqual({
      days: null,
    });
    expect(panel.textContent).toMatch(/Unlimited/);
  });

  it('asks for confirmation before shortening the period, and sends nothing on cancel', async () => {
    const api = fakeApi(routes(90));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Retention' });
    const period = within(panel).getByLabelText('Retention period (days)') as HTMLInputElement;
    await userEvent.clear(period);
    await userEvent.type(period, '7');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save retention' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));

    expect(api.calls.some((c) => c.route === 'PUT /api/instance/retention')).toBe(false);
    expect(period.value).toBe('7');
  });

  it('lengthens the period without confirmation: nothing more is erased', async () => {
    const api = fakeApi(routes(30));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Retention' });
    const period = within(panel).getByLabelText('Retention period (days)') as HTMLInputElement;
    await userEvent.clear(period);
    await userEvent.type(period, '90');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save retention' }));

    expect(await within(panel).findByText(/Saved/)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/retention')?.body).toEqual({
      days: 90,
    });
  });
});

describe('Instance settings: SMTP server', () => {
  const SMTP: InstanceSmtpView = {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'nudge',
    passwordConfigured: true,
    fromAddress: 'nudge@example.com',
    fromName: null,
  };
  const routes = (smtp: InstanceSmtpView | null) => ({
    ...instanceRoutes(),
    'GET /api/instance/smtp': { status: 200, body: { smtp } },
    'PUT /api/instance/smtp': (body: unknown) => {
      const { password, ...rest } = body as Record<string, unknown>;
      return {
        status: 200,
        body: { ...rest, passwordConfigured: password !== undefined || smtp !== null },
      };
    },
  });

  it('without a server, says so and saves one with its password', async () => {
    const api = fakeApi(routes(null));
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Email (SMTP)' });
    expect(within(panel).getByText('Not configured')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Send test email' })).toBeNull();
    await userEvent.type(within(panel).getByLabelText('SMTP host'), 'smtp.example.com');
    await userEvent.type(within(panel).getByLabelText('Username (optional)'), 'nudge');
    await userEvent.type(within(panel).getByLabelText('Password'), 'smtp-secret');
    await userEvent.type(within(panel).getByLabelText('From address'), 'nudge@example.com');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save SMTP server' }));

    expect(await within(panel).findByText('Configured')).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/smtp')?.body).toEqual({
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls',
      username: 'nudge',
      password: 'smtp-secret',
      fromAddress: 'nudge@example.com',
      fromName: null,
    });
    expect((within(panel).getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(within(panel).getByRole('button', { name: 'Send test email' })).toBeTruthy();
  });

  it('the port follows the security mode while it is the usual one', async () => {
    fakeApi(routes(null));
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Email (SMTP)' });
    const port = within(panel).getByLabelText('Port') as HTMLInputElement;
    await userEvent.selectOptions(within(panel).getByLabelText('Security'), 'tls');
    expect(port.value).toBe('465');
    await userEvent.clear(port);
    await userEvent.type(port, '2465');
    await userEvent.selectOptions(within(panel).getByLabelText('Security'), 'starttls');
    expect(port.value).toBe('2465');
  });

  it('keeps the saved password only while host and username stay the same', async () => {
    fakeApi(routes(SMTP));
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Email (SMTP)' });
    expect(within(panel).getByText(/A password is saved/)).toBeTruthy();
    await userEvent.type(within(panel).getByLabelText('SMTP host'), '.eu');
    expect(within(panel).queryByText(/A password is saved/)).toBeNull();
  });

  it('sends a test email to the signed-in Member, and shows a refusal', async () => {
    const api = fakeApi({
      ...routes(SMTP),
      'POST /api/instance/smtp/test': {
        status: 200,
        body: { status: 'delivered', externalUrl: null },
      },
    });
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Email (SMTP)' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Send test email' }));
    expect(await within(panel).findByText(/Test email sent to ada@nudge.test/)).toBeTruthy();

    api.set('POST /api/instance/smtp/test', {
      status: 200,
      body: { status: 'failed', failureClass: 'auth', message: '535 Authentication failed' },
    });
    await userEvent.click(within(panel).getByRole('button', { name: 'Send test email' }));
    expect(await within(panel).findByText(/535 Authentication failed/)).toBeTruthy();
  });

  it('removes the server after confirmation', async () => {
    const api = fakeApi({ ...routes(SMTP), 'DELETE /api/instance/smtp': { status: 204 } });
    renderDashboard('/settings');

    const panel = await screen.findByRole('form', { name: 'Email (SMTP)' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));

    expect(await within(panel).findByText('Not configured')).toBeTruthy();
    expect(api.calls.some((c) => c.route === 'DELETE /api/instance/smtp')).toBe(true);
  });
});
