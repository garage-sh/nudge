import type { DestinationView, ProjectView } from '@nudge/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SIGNED_IN, fakeApi } from './test/fake-api.js';
import { renderDashboard } from './test/render.js';

const SHOP: ProjectView = {
  id: 'project-1',
  name: 'Shop',
  description: null,
  publicKey: 'nk_pub_shop',
  allowedOrigins: [],
  createdAt: '2026-10-24T08:00:00.000Z',
};

const RECEIVER: DestinationView = {
  id: 'destination-1',
  projectId: 'project-1',
  name: 'Internal receiver',
  type: 'webhook',
  config: { url: 'https://receiver.test/nudge' },
  filter: { types: ['bug', 'question'], minimumSeverity: 'major' },
  state: 'active',
  secrets: ['signingSecret'],
  createdAt: '2026-10-24T08:10:00.000Z',
};

const baseRoutes = (destinations: DestinationView[] = [RECEIVER]) => ({
  'GET /api/session': SIGNED_IN,
  'GET /api/projects/project-1': { status: 200, body: SHOP },
  'GET /api/projects/project-1/destinations': { status: 200, body: destinations },
});

const card = async (name: string) =>
  within((await screen.findByRole('heading', { name })).closest('article') as HTMLElement);

describe('A Project’s Destinations', () => {
  it('opens from the Project', async () => {
    fakeApi(baseRoutes());
    renderDashboard('/projects/project-1');

    await userEvent.click(await screen.findByRole('link', { name: 'Destinations' }));

    expect(await screen.findByRole('heading', { name: 'Internal receiver' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Destinations' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('lists the Destinations with their type, state and Filter', async () => {
    fakeApi(baseRoutes());
    renderDashboard('/projects/project-1/destinations');

    const receiver = await card('Internal receiver');
    expect(receiver.getByText('Webhook')).toBeTruthy();
    expect(receiver.getByText('Active')).toBeTruthy();
    expect(receiver.getByText('https://receiver.test/nudge')).toBeTruthy();
    expect(receiver.getByText('Bug, Question')).toBeTruthy();
    expect(receiver.getByText('Major or higher')).toBeTruthy();
  });

  it('announces a Project without a Destination', async () => {
    fakeApi(baseRoutes([]));
    renderDashboard('/projects/project-1/destinations');

    expect(await screen.findByText(/No Destination/)).toBeTruthy();
  });

  it('adds a webhook and shows its signing secret only once', async () => {
    const api = fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 201,
        body: { destination: RECEIVER, generatedSecrets: { signingSecret: 'whsec-unique' } },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const form = within(
      (await screen.findByRole('heading', { name: 'Add Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    expect((form.getByRole('option', { name: 'Webhook' }) as HTMLOptionElement).selected).toBe(
      true,
    );
    await userEvent.type(form.getByLabelText('Name'), 'Internal receiver');
    await userEvent.type(form.getByLabelText('URL'), 'https://receiver.test/nudge');
    await userEvent.click(form.getByLabelText('Suggestion'));
    await userEvent.click(form.getByLabelText('Opinion'));
    await userEvent.selectOptions(form.getByLabelText('Minimum Severity'), 'major');
    await userEvent.click(form.getByRole('button', { name: 'Add' }));

    expect((await screen.findByLabelText('Signing secret')).textContent).toBe('whsec-unique');
    expect(screen.getByText(/will never be shown again/)).toBeTruthy();
    expect(
      api.calls.find((c) => c.route === 'POST /api/projects/project-1/destinations')?.body,
    ).toEqual({
      type: 'webhook',
      name: 'Internal receiver',
      config: { url: 'https://receiver.test/nudge' },
      filter: { types: ['bug', 'question'], minimumSeverity: 'major' },
    });
  });

  it('adds a Discord channel: the webhook URL goes as a secret', async () => {
    const CHANNEL: DestinationView = {
      ...RECEIVER,
      name: 'Channel #bugs',
      type: 'discord',
      config: {},
      secrets: ['url'],
    };
    const URL_WEBHOOK = 'https://discord.com/api/webhooks/223704706495545344/channel-token';
    const api = fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 201,
        body: { destination: CHANNEL, generatedSecrets: {} },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const form = within(
      (await screen.findByRole('heading', { name: 'Add Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(form.getByLabelText('Type'), 'Discord');
    await userEvent.type(form.getByLabelText('Name'), 'Channel #bugs');
    const urlField = form.getByLabelText('Webhook URL') as HTMLInputElement;
    expect(urlField.type).toBe('password');
    await userEvent.type(urlField, URL_WEBHOOK);
    await userEvent.click(form.getByRole('button', { name: 'Add' }));

    await vi.waitFor(() =>
      expect(
        api.calls.find((c) => c.route === 'POST /api/projects/project-1/destinations')?.body,
      ).toEqual({
        type: 'discord',
        name: 'Channel #bugs',
        config: {},
        secrets: { url: URL_WEBHOOK },
        filter: { types: ['bug', 'suggestion', 'opinion', 'question'], minimumSeverity: null },
      }),
    );
  });

  it('edits a Discord channel without typing the saved URL again', async () => {
    const CHANNEL: DestinationView = {
      ...RECEIVER,
      name: 'Channel #bugs',
      type: 'discord',
      config: {},
      secrets: ['url'],
    };
    const api = fakeApi({
      ...baseRoutes([CHANNEL]),
      'PATCH /api/destinations/destination-1': { status: 200, body: CHANNEL },
    });
    renderDashboard('/projects/project-1/destinations');

    const channel = await card('Channel #bugs');
    expect(channel.getByText('Discord')).toBeTruthy();
    await userEvent.click(channel.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit Channel #bugs' }));
    const urlField = form.getByLabelText('Webhook URL') as HTMLInputElement;
    expect(urlField.value).toBe('');
    expect(urlField.required).toBe(false);
    expect(form.getByText(/saved \(encrypted\)/)).toBeTruthy();
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() =>
      expect(
        api.calls.find((c) => c.route === 'PATCH /api/destinations/destination-1')?.body,
      ).not.toHaveProperty('secrets'),
    );
  });

  it('adds a Slack channel: the incoming webhook URL goes as a secret', async () => {
    const SLACK_CHANNEL: DestinationView = {
      ...RECEIVER,
      name: 'Slack #bugs',
      type: 'slack',
      config: {},
      secrets: ['url'],
    };
    const URL_WEBHOOK = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX';
    const api = fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 201,
        body: { destination: SLACK_CHANNEL, generatedSecrets: {} },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const form = within(
      (await screen.findByRole('heading', { name: 'Add Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(form.getByLabelText('Type'), 'Slack');
    await userEvent.type(form.getByLabelText('Name'), 'Slack #bugs');
    const urlField = form.getByLabelText('Webhook URL') as HTMLInputElement;
    expect(urlField.type).toBe('password');
    expect(urlField.placeholder).toBe('https://hooks.slack.com/services/…');
    await userEvent.type(urlField, URL_WEBHOOK);
    await userEvent.click(form.getByRole('button', { name: 'Add' }));

    await vi.waitFor(() =>
      expect(
        api.calls.find((c) => c.route === 'POST /api/projects/project-1/destinations')?.body,
      ).toEqual({
        type: 'slack',
        name: 'Slack #bugs',
        config: {},
        secrets: { url: URL_WEBHOOK },
        filter: { types: ['bug', 'suggestion', 'opinion', 'question'], minimumSeverity: null },
      }),
    );
  });

  it('adds a GitHub repository: token as a secret, repository as configuration', async () => {
    const REPOSITORY: DestinationView = {
      ...RECEIVER,
      name: 'Issues shop-web',
      type: 'github',
      config: { repository: 'shop-inc/shop-web' },
      secrets: ['token'],
    };
    const api = fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 201,
        body: { destination: REPOSITORY, generatedSecrets: {} },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const form = within(
      (await screen.findByRole('heading', { name: 'Add Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(form.getByLabelText('Type'), 'GitHub Issues');
    await userEvent.type(form.getByLabelText('Name'), 'Issues shop-web');
    const tokenField = form.getByLabelText('Access token') as HTMLInputElement;
    expect(tokenField.type).toBe('password');
    await userEvent.type(tokenField, 'github_pat_secret');
    await userEvent.type(form.getByLabelText('Repository'), 'shop-inc/shop-web');
    await userEvent.click(form.getByRole('button', { name: 'Add' }));

    await vi.waitFor(() =>
      expect(
        api.calls.find((c) => c.route === 'POST /api/projects/project-1/destinations')?.body,
      ).toEqual({
        type: 'github',
        name: 'Issues shop-web',
        config: { repository: 'shop-inc/shop-web' },
        secrets: { token: 'github_pat_secret' },
        filter: { types: ['bug', 'suggestion', 'opinion', 'question'], minimumSeverity: null },
      }),
    );
  });

  it('edits a GitHub repository without typing the saved token again', async () => {
    const REPOSITORY: DestinationView = {
      ...RECEIVER,
      name: 'Issues shop-web',
      type: 'github',
      config: { repository: 'shop-inc/shop-web' },
      secrets: ['token'],
    };
    const api = fakeApi({
      ...baseRoutes([REPOSITORY]),
      'PATCH /api/destinations/destination-1': { status: 200, body: REPOSITORY },
    });
    renderDashboard('/projects/project-1/destinations');

    const repositoryCard = await card('Issues shop-web');
    expect(repositoryCard.getByText('GitHub Issues')).toBeTruthy();
    expect(repositoryCard.getByText('Repository shop-inc/shop-web')).toBeTruthy();
    await userEvent.click(repositoryCard.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit Issues shop-web' }));
    const tokenField = form.getByLabelText('Access token') as HTMLInputElement;
    expect(tokenField.value).toBe('');
    expect(tokenField.required).toBe(false);
    await userEvent.clear(form.getByLabelText('Repository'));
    await userEvent.type(form.getByLabelText('Repository'), 'shop-inc/api');
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      const body = api.calls.find((c) => c.route === 'PATCH /api/destinations/destination-1')
        ?.body as Record<string, unknown> | undefined;
      expect(body).not.toHaveProperty('secrets');
      expect(body?.config).toEqual({ repository: 'shop-inc/api' });
    });
  });

  it('adds a Linear team: API key as a secret, team and labels by type and Severity', async () => {
    const TEAM: DestinationView = {
      ...RECEIVER,
      name: 'Linear ENG',
      type: 'linear',
      config: {
        team: 'ENG',
        labels: { types: { bug: 'Bug' }, severities: { blocking: 'Urgent' } },
      },
      secrets: ['apiKey'],
    };
    const api = fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 201,
        body: { destination: TEAM, generatedSecrets: {} },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const form = within(
      (await screen.findByRole('heading', { name: 'Add Destination' })).closest(
        'form',
      ) as HTMLElement,
    );
    await userEvent.selectOptions(form.getByLabelText('Type'), 'Linear');
    await userEvent.type(form.getByLabelText('Name'), 'Linear ENG');
    const keyField = form.getByLabelText('API key') as HTMLInputElement;
    expect(keyField.type).toBe('password');
    await userEvent.type(keyField, 'lin_api_secret');
    await userEvent.type(form.getByLabelText('Team'), 'ENG');
    await userEvent.type(form.getByLabelText('Label for type Bug'), 'Bug');
    await userEvent.type(form.getByLabelText('Label for type Opinion'), 'x');
    await userEvent.clear(form.getByLabelText('Label for type Opinion'));
    await userEvent.type(form.getByLabelText('Label for Severity Blocking'), 'Urgent');
    await userEvent.click(form.getByRole('button', { name: 'Add' }));

    await vi.waitFor(() =>
      expect(
        api.calls.find((c) => c.route === 'POST /api/projects/project-1/destinations')?.body,
      ).toEqual({
        type: 'linear',
        name: 'Linear ENG',
        config: {
          team: 'ENG',
          labels: { types: { bug: 'Bug' }, severities: { blocking: 'Urgent' } },
        },
        secrets: { apiKey: 'lin_api_secret' },
        filter: { types: ['bug', 'suggestion', 'opinion', 'question'], minimumSeverity: null },
      }),
    );
  });

  it('edits a Linear team without typing the API key again, labels kept', async () => {
    const TEAM: DestinationView = {
      ...RECEIVER,
      name: 'Linear ENG',
      type: 'linear',
      config: { team: 'ENG', labels: { types: { bug: 'Bug' }, severities: {} } },
      secrets: ['apiKey'],
    };
    const api = fakeApi({
      ...baseRoutes([TEAM]),
      'PATCH /api/destinations/destination-1': { status: 200, body: TEAM },
    });
    renderDashboard('/projects/project-1/destinations');

    const teamCard = await card('Linear ENG');
    expect(teamCard.getByText('Linear')).toBeTruthy();
    expect(teamCard.getByText('Team ENG')).toBeTruthy();
    await userEvent.click(teamCard.getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit Linear ENG' }));
    const keyField = form.getByLabelText('API key') as HTMLInputElement;
    expect(keyField.value).toBe('');
    expect(keyField.required).toBe(false);
    expect((form.getByLabelText('Label for type Bug') as HTMLInputElement).value).toBe('Bug');
    await userEvent.clear(form.getByLabelText('Label for type Bug'));
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      const body = api.calls.find((c) => c.route === 'PATCH /api/destinations/destination-1')
        ?.body as Record<string, unknown> | undefined;
      expect(body).not.toHaveProperty('secrets');
      expect(body?.config).toEqual({ team: 'ENG', labels: { types: {}, severities: {} } });
    });
  });

  it('shows the API’s refusal when adding', async () => {
    fakeApi({
      ...baseRoutes([]),
      'POST /api/projects/project-1/destinations': {
        status: 400,
        body: {
          error: 'invalid_request',
          details: [{ path: 'config.url', message: 'http(s) URL expected, without credentials' }],
        },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    await userEvent.type(await screen.findByLabelText('Name'), 'Receiver');
    await userEvent.type(screen.getByLabelText('URL'), 'ftp://receiver.test');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/http\(s\) URL expected/);
  });

  it('edits a Destination’s Filter', async () => {
    const api = fakeApi({
      ...baseRoutes(),
      'PATCH /api/destinations/destination-1': (body) => ({
        status: 200,
        body: { ...RECEIVER, ...(body as object) },
      }),
    });
    renderDashboard('/projects/project-1/destinations');

    await userEvent.click((await card('Internal receiver')).getByRole('button', { name: 'Edit' }));
    const form = within(screen.getByRole('form', { name: 'Edit Internal receiver' }));
    expect((form.getByLabelText('URL') as HTMLInputElement).value).toBe(
      'https://receiver.test/nudge',
    );
    await userEvent.click(form.getByLabelText('Question'));
    await userEvent.selectOptions(form.getByLabelText('Minimum Severity'), '');
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    const edited = await card('Internal receiver');
    expect(edited.getByText('Bug')).toBeTruthy();
    expect(edited.getByText('any Severity')).toBeTruthy();
    expect(
      api.calls.find((c) => c.route === 'PATCH /api/destinations/destination-1')?.body,
    ).toEqual({
      name: 'Internal receiver',
      config: { url: 'https://receiver.test/nudge' },
      filter: { types: ['bug'], minimumSeverity: null },
    });
  });

  it('tests a Destination and shows the result', async () => {
    const api = fakeApi({
      ...baseRoutes(),
      'POST /api/destinations/destination-1/test': {
        status: 200,
        body: { status: 'failed', failureClass: 'auth', message: 'HTTP 401: unknown signature' },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const receiver = await card('Internal receiver');
    await userEvent.click(receiver.getByRole('button', { name: 'Test' }));

    expect((await receiver.findByRole('status')).textContent).toBe(
      'Failed (credentials refused): HTTP 401: unknown signature',
    );

    api.set('POST /api/destinations/destination-1/test', {
      status: 200,
      body: { status: 'delivered', externalUrl: null },
    });
    await userEvent.click(receiver.getByRole('button', { name: 'Test' }));
    expect((await receiver.findByRole('status')).textContent).toBe('Sample Feedback delivered.');
  });

  it('regenerates the signing secret after confirmation', async () => {
    fakeApi({
      ...baseRoutes(),
      'POST /api/destinations/destination-1/generated-secrets': {
        status: 201,
        body: { destination: RECEIVER, generatedSecrets: { signingSecret: 'whsec-new' } },
      },
    });
    renderDashboard('/projects/project-1/destinations');

    const receiver = await card('Internal receiver');
    await userEvent.click(receiver.getByRole('button', { name: 'Regenerate signing secret' }));
    await userEvent.click(receiver.getByRole('button', { name: 'Confirm' }));

    expect((await screen.findByLabelText('Signing secret')).textContent).toBe('whsec-new');
  });

  it('deletes a Destination after confirmation', async () => {
    const api = fakeApi({
      ...baseRoutes(),
      'DELETE /api/destinations/destination-1': { status: 204 },
    });
    renderDashboard('/projects/project-1/destinations');

    const receiver = await card('Internal receiver');
    await userEvent.click(receiver.getByRole('button', { name: 'Delete' }));
    expect(api.calls.map((c) => c.route)).not.toContain('DELETE /api/destinations/destination-1');
    api.set('GET /api/projects/project-1/destinations', { status: 200, body: [] });
    await userEvent.click(receiver.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByText(/No Destination/)).toBeTruthy();
    expect(api.calls.map((c) => c.route)).toContain('DELETE /api/destinations/destination-1');
  });

  it('shows the name and the URL as text, never as HTML', async () => {
    fakeApi(
      baseRoutes([
        {
          ...RECEIVER,
          name: '<img src=x onerror="alert(1)">',
          config: { url: 'javascript:alert(1)' },
        },
      ]),
    );
    renderDashboard('/projects/project-1/destinations');

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
