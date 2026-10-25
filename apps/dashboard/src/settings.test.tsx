import type { InstanceJudgeView } from '@nudge/shared';
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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

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
    'GET /api/instance/retention': { status: 200, body: { days } },
    'PUT /api/instance/retention': (body: unknown) => ({ status: 200, body }),
  });

  it('unlimited by default, sets a period in days', async () => {
    const api = fakeApi(routes(null));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Feedback retention' });
    expect(panel.textContent).toMatch(/Unlimited/);
    const period = within(panel).getByLabelText('Retention period (days)') as HTMLInputElement;
    expect(period.value).toBe('');
    await userEvent.type(period, '90');
    await userEvent.click(within(panel).getByRole('button', { name: 'Save retention' }));
    // Going from unlimited to a period erases Feedback: confirmation first.
    expect(within(panel).getByRole('group').textContent).toMatch(
      /older than 90 days .* permanently erased/,
    );
    await userEvent.click(within(panel).getByRole('button', { name: 'Confirm' }));

    expect(await within(panel).findByText(/Saved/)).toBeTruthy();
    expect(api.calls.find((c) => c.route === 'PUT /api/instance/retention')?.body).toEqual({
      days: 90,
    });
    expect(panel.textContent).toMatch(/older than 90 days is erased automatically/);
  });

  it('goes back to unlimited retention by clearing the field', async () => {
    const api = fakeApi(routes(30));
    renderDashboard('/settings');

    const panel = await screen.findByRole('region', { name: 'Feedback retention' });
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

    const panel = await screen.findByRole('region', { name: 'Feedback retention' });
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

    const panel = await screen.findByRole('region', { name: 'Feedback retention' });
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
