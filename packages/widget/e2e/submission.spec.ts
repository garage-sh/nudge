import type { Page } from '@playwright/test';
import { API, CDN, HOST_ORIGIN, PUBLIC_KEY, expect, test } from './host.js';

test('sends free-text Feedback with the page context', async ({ page, host, api }) => {
  await host.open({ path: '/cart?step=2' });

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('The cart empties itself');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  expect(api.requests).toEqual([
    {
      authorization: `Bearer ${PUBLIC_KEY}`,
      origin: HOST_ORIGIN,
      body: {
        text: 'The cart empties itself',
        context: {
          url: `${HOST_ORIGIN}/cart?step=2`,
          userAgent: expect.stringContaining('Mozilla/5.0'),
          viewport: { width: 1280, height: 720 },
        },
      },
    },
  ]);
});

const sendHello = async (page: Page) => {
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status')).toBeVisible();
};

test('leaves the fragment out of the page URL, where tokens often travel', async ({
  page,
  host,
  api,
}) => {
  await host.open({ path: '/callback?step=2#access_token=secret' });

  await sendHello(page);

  expect(api.requests[0]?.body).toMatchObject({
    context: { url: `${HOST_ORIGIN}/callback?step=2` },
  });
});

test("sends the page URL as the integrator's redactUrl rewrites it", async ({
  page,
  host,
  api,
}) => {
  await host.open({
    path: '/invoices/42?token=secret&tab=paid#details',
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>
  Nudge.mountWidget({
    publicKey: '${PUBLIC_KEY}',
    api: '${API}',
    redactUrl: (url) => {
      url.searchParams.delete('token');
      return url;
    },
  });
</script>`,
  });

  await sendHello(page);

  expect(api.requests[0]?.body).toMatchObject({
    context: { url: `${HOST_ORIGIN}/invoices/42?tab=paid#details` },
  });
});

test('sends no page URL when redactUrl returns null or fails', async ({ page, host, api }) => {
  await host.open({
    path: '/account?token=secret',
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>
  const widget = Nudge.mountWidget({ publicKey: '${PUBLIC_KEY}', api: '${API}', redactUrl: () => null });
  window.failRedaction = () => {
    widget.redactUrl = () => {
      throw new Error('redaction failed');
    };
  };
</script>`,
  });

  await sendHello(page);
  await page.evaluate(() => (window as unknown as { failRedaction: () => void }).failRedaction());
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await sendHello(page);

  expect(api.requests).toHaveLength(2);
  for (const request of api.requests) {
    expect((request.body as { context: object }).context).not.toHaveProperty('url');
  }
});

test('sends the Type and email the Author chose', async ({ page, host, api }) => {
  await host.open();

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('A dark mode would be welcome');
  await page.getByRole('radio', { name: 'Suggestion' }).check();
  await page.getByLabel('Email (optional)').fill('ada@example.test');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toHaveText('Thank you! Your feedback has been sent.');
  expect(api.requests[0]?.body).toMatchObject({
    text: 'A dark mode would be welcome',
    type: 'suggestion',
    author: { email: 'ada@example.test' },
  });
});

test('sends nothing while the message is empty', async ({ page, host, api }) => {
  await host.open();

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('   ');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByLabel('Your message')).toHaveJSProperty(
    'validationMessage',
    'Write your message before sending.',
  );
  expect(api.requests).toEqual([]);
});

test('attaches the identity and metadata passed by the host', async ({ page, host, api }) => {
  await host.open({
    integration: `<script src="${CDN}/nudge-widget.js"></script>
<script>
  Nudge.mountWidget({
    publicKey: '${PUBLIC_KEY}',
    api: '${API}',
    author: { id: 'u-42', email: 'ada@example.test', name: 'Ada' },
    metadata: { version: '2.3.1', beta: true },
  });
</script>`,
  });

  await page.getByRole('button', { name: 'Send feedback' }).click();
  await page.getByLabel('Your message').fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByRole('status')).toBeVisible();
  expect(api.requests[0]?.body).toMatchObject({
    author: { id: 'u-42', email: 'ada@example.test', name: 'Ada' },
    context: { metadata: { version: '2.3.1', beta: true } },
  });
});
